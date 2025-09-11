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

            # STEP 1: Write the initial state to Redis FIRST.
            print(f"[{player_id}] DISPATCHER: Creating aggregation state.")
            redis_service.redis_client.hset(
                aggregation_key,
                mapping={
                    "total": total_matches,
                    "processed": 0,
                    "player_id": player_id,
                },
            )
            redis_service.redis_client.expire(aggregation_key, 3600)

            # STEP 2: Now, enqueue all the fetcher tasks.
            print(
                f"[{player_id}] DISPATCHER: Enqueuing {total_matches} fetcher tasks..."
            )
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
    Fetches details for a single match, guaranteeing progress is always reported.
    """
    print(f"[{player_id}] FETCHER: Starting for match {match_id}.")

    try:
        # --- RATE LIMITING LOGIC ---
        while True:
            lock_acquired = redis_service.redis_client.set(
                config.RATE_LIMIT_LOCK_KEY, 1, px=config.API_REQUEST_DELAY_MS, nx=True
            )
            if lock_acquired:
                break
            await asyncio.sleep(0.1)

        # --- HTTP REQUEST LOGIC ---
        async with httpx.AsyncClient(timeout=15.0) as client:
            # We assume get_match_details_async is updated to catch its own errors
            # and return None on failure, as discussed previously.
            details = await riot_api_client.get_match_details_async(
                client, match_id, puuid, region
            )
            if details:
                timestamp = details.get("timestamp", 0)
                redis_service.redis_client.zadd(
                    partial_results_key, {json.dumps(details, default=str): timestamp}
                )
                print(f"[{player_id}] FETCHER: -> Stored details for match {match_id}.")

    except Exception as e:
        # This broad exception catch ensures that ANY failure within the task
        # is logged, but doesn't crash the task before the 'finally' block.
        print(f"[{player_id}] FETCHER: -> FAILED for match {match_id} with error: {e}")

    finally:
        # --- GUARANTEED PROGRESS & TRIGGER LOGIC ---
        # This block runs whether the 'try' block succeeded or failed.
        processed_count = redis_service.redis_client.hincrby(
            aggregation_key, "processed", 1
        )
        total_count = int(
            redis_service.redis_client.hget(aggregation_key, "total") or 0
        )
        print(
            f"[{player_id}] FETCHER: Progress is now {processed_count}/{total_count}."
        )

        # The trigger logic now reliably runs on every task completion.
        if total_count > 0 and processed_count >= total_count:
            print(
                f"[{player_id}] FETCHER: Final task complete. Triggering aggregation."
            )
            arq_pool = ctx["redis"]
            await arq_pool.enqueue_job(
                "aggregate_results_task",
                aggregation_key,
                partial_results_key,
                player_id,
            )


# --- TASK 3: The Aggregator ---
async def aggregate_results_task(
    ctx, aggregation_key: str, partial_results_key: str, player_id: str
):
    """
    This final task renames the completed results set to the final cache key
    and cleans up all temporary job keys atomically.
    """
    print(f"[{player_id}] AGGREGATOR: Started.")

    cache_key = f"cache:{player_id}"
    cooldown_key = f"cooldown:{player_id}"
    lock_key = f"lock:{player_id}"

    try:
        # Start a transaction to make the final steps atomic.
        pipe = redis_service.redis_client.pipeline()

        # 1. Rename the sorted set of results to its final cache key.
        # This is an atomic, instantaneous operation in Redis.
        pipe.rename(partial_results_key, cache_key)

        # 2. Set the expiration on the final cache key.
        pipe.expire(cache_key, config.CACHE_EXPIRATION_SECONDS)

        # 3. Set the cooldown key for the user.
        pipe.setex(cooldown_key, config.COOLDOWN_SECONDS, 1)

        # 4. Delete the temporary aggregation counter and the job lock.
        pipe.delete(aggregation_key)
        pipe.delete(lock_key)

        # Execute all commands in the pipeline at once.
        pipe.execute()

        print(
            f"[{player_id}] AGGREGATOR: Atomically cached results and cleaned up keys."
        )

    except Exception as e:
        print(f"[{player_id}] AGGREGATOR: FAILED during atomic transaction: {e}")
        # If the rename fails (e.g., partial_results_key doesn't exist),
        # we should still clean up.
        redis_service.redis_client.delete(
            aggregation_key, lock_key, partial_results_key
        )
        redis_service.release_lock(lock_key)  # Defensive release

    print(f"[{player_id}] AGGREGATOR: Finished. Job complete.")
