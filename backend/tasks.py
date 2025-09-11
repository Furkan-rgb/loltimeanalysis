# tasks.py
import httpx
import asyncio
import json

import config
import redis_service
import riot_api_client


# --- TASK 1: The Dispatcher ---
async def dispatch_fetch_job(ctx, game_name: str, tag_line: str, region: str):
    """
    This is the main entry point. It fetches the list of match IDs and "fans-out"
    a separate job for each individual match.
    """
    player_id = f"{game_name.lower()}#{tag_line.lower()}"
    job_key_prefix = f"job:{player_id}"
    lock_key = f"lock:{player_id}"

    aggregation_key = f"{job_key_prefix}:agg"
    partial_results_key = f"{job_key_prefix}:results"

    print(f"[{player_id}] DISPATCHER: Started.")

    try:
        async with httpx.AsyncClient() as client:
            puuid = await riot_api_client.get_puuid(client, game_name, tag_line, region)

            all_match_ids = []
            start_index = 0
            while len(all_match_ids) < config.GAMES_TO_FETCH:
                count_to_fetch = min(100, config.GAMES_TO_FETCH - len(all_match_ids))
                chunk_match_ids = await riot_api_client.get_match_ids_async(
                    client, puuid, count_to_fetch, start_index, region
                )

                if not chunk_match_ids:
                    break

                all_match_ids.extend(chunk_match_ids)
                start_index += len(chunk_match_ids)

                if len(chunk_match_ids) < 100:
                    break

                await asyncio.sleep(config.API_REQUEST_DELAY_SECONDS)

            if not all_match_ids:
                print(f"[{player_id}] DISPATCHER: No matches found. Job complete.")
                redis_service.release_lock(lock_key)
                return

            total_matches = len(all_match_ids)
            print(
                f"[{player_id}] DISPATCHER: Found {total_matches} matches. Enqueuing sub-tasks..."
            )

            # STEP 1: Enqueue all the jobs FIRST.
            arq_pool = ctx["redis"]
            for match_id in all_match_ids:
                await arq_pool.enqueue_job(
                    "fetch_match_details_task",
                    match_id,
                    puuid,
                    region,
                    aggregation_key,
                    partial_results_key,
                    player_id,
                )

            # STEP 2: ONLY AFTER the loop is successful, "commit" the state to Redis.
            print(
                f"[{player_id}] DISPATCHER: All {total_matches} sub-tasks enqueued. Creating aggregation state."
            )
            redis_service.redis_client.hset(
                aggregation_key,
                mapping={
                    "total": total_matches,
                    "processed": 0,
                    "player_id": player_id,
                },
            )
            redis_service.redis_client.expire(aggregation_key, 3600)

    except Exception as e:
        print(f"[{player_id}] DISPATCHER: FAILED with error: {e}")
        redis_service.release_lock(lock_key)


# --- TASK 2: The Detail-Fetcher ---
async def fetch_match_details_task(
    ctx,
    match_id: str,
    puuid: str,
    region: str,
    aggregation_key: str,
    partial_results_key: str,
    player_id: str,
):
    """
    A simple, small task that fetches details for a single match and
    stores the result in a Redis List, respecting the global rate limit.
    """

    print(f"[{player_id}] FETCHER: Starting for match {match_id}.")

    # --- RATE LIMITING LOGIC ---
    while True:
        # Try to acquire the lock. SET if Not eXists, with an EXpiration of 1.25s.
        # This is an atomic operation.
        lock_acquired = redis_service.redis_client.set(
            config.RATE_LIMIT_LOCK_KEY, 1, px=config.API_REQUEST_DELAY_MS, nx=True
        )
        if lock_acquired:
            # We got the lock, break the loop and proceed.
            break
        # Lock is held by another worker, wait a short time and try again.
        await asyncio.sleep(0.1)

    # --- ORIGINAL TASK LOGIC ---
    async with httpx.AsyncClient() as client:
        details = await riot_api_client.get_match_details_async(
            client, match_id, puuid, region
        )
        if details:
            # Store partial result as a JSON string in a list
            redis_service.redis_client.rpush(
                partial_results_key, json.dumps(details, default=str)
            )
            print(f"[{player_id}] FETCHER: -> Stored details for match {match_id}.")
        else:
            print(
                f"[{player_id}] FETCHER: -> FAILED to get details for match {match_id}."
            )

    # Fan-in: Atomically increment the processed counter
    processed_count = redis_service.redis_client.hincrby(
        aggregation_key, "processed", 1
    )

    # Check if this is the last task
    total_count = int(redis_service.redis_client.hget(aggregation_key, "total") or 0)

    print(f"[{player_id}] FETCHER: Progress is now {processed_count}/{total_count}.")

    if total_count > 0 and processed_count >= total_count:
        # This is the last worker, trigger the final aggregation task
        print(
            f"[{player_id}] FETCHER: Final sub-task complete. Triggering aggregation."
        )
        arq_pool = ctx["redis"]
        await arq_pool.enqueue_job(
            "aggregate_results_task", aggregation_key, partial_results_key, player_id
        )


# --- TASK 3: The Aggregator ---
async def aggregate_results_task(
    ctx, aggregation_key: str, partial_results_key: str, player_id: str
):
    """
    This final task gathers all partial results, saves them to the main cache,
    and cleans up all temporary job keys atomically.
    """
    print(f"[{player_id}] AGGREGATOR: Started.")

    # 1. Get all partial results (this is a read operation, so it's separate)
    results_json = redis_service.redis_client.lrange(partial_results_key, 0, -1)
    if not results_json:
        print(f"[{player_id}] AGGREGATOR: No partial results found. Cleaning up.")
        # Even if there's no data, we should clean up the job keys.
        redis_service.redis_client.delete(aggregation_key, partial_results_key)
        redis_service.release_lock(f"lock:{player_id}")
        return

    all_games_data = [json.loads(item) for item in results_json]
    print(f"[{player_id}] AGGREGATOR: Aggregating {len(all_games_data)} results.")

    # 2. Sort the data by timestamp
    all_games_data.sort(key=lambda x: x["timestamp"], reverse=True)

    # 3. Atomically save results and clean up using a pipeline
    cache_key = f"cache:{player_id}"
    cooldown_key = f"cooldown:{player_id}"
    lock_key = f"lock:{player_id}"
    data_to_cache = json.dumps(all_games_data, default=str)

    try:
        # Start a transaction
        pipe = redis_service.redis_client.pipeline()

        # Queue all the commands
        pipe.setex(cache_key, config.CACHE_EXPIRATION_SECONDS, data_to_cache)
        pipe.setex(
            cooldown_key, config.COOLDOWN_SECONDS, 1
        )  # Assuming COOLDOWN_SECONDS is in config
        pipe.delete(aggregation_key)
        pipe.delete(partial_results_key)
        pipe.delete(lock_key)

        # Execute them all at once
        pipe.execute()

        print(f"[{player_id}] AGGREGATOR: Atomically saved cache and cleaned up keys.")

    except Exception as e:
        print(f"[{player_id}] AGGREGATOR: FAILED during atomic transaction: {e}")
        # Here you might want to add logic to handle a failed transaction,
        # though it's rare for this block to fail if Redis is running.

    print(f"[{player_id}] AGGREGATOR: Finished. Job complete.")
