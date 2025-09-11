import httpx
import asyncio
from datetime import datetime

import config
import redis_service
import riot_api_client
import arq

# This is the main task ARQ will run.
async def fetch_ranked_history_task(ctx, game_name: str, tag_line: str, region: str):
    """The background task to fetch, process, and cache ranked history."""
    player_id = f"{game_name.lower()}#{tag_line.lower()}"
    status_key = f"status:{player_id}"
    cache_key = f"cache:{player_id}"
    cooldown_key = f"cooldown:{player_id}"
    lock_key = f"lock:{player_id}"
    
    # The worker context 'ctx' provides a redis connection pool.
    redis = ctx['redis']

    try:
        # 1. Acquire lock and set initial status
        if not redis_service.acquire_lock(lock_key, config.LOCK_TIMEOUT_SECONDS):
            # This should rarely happen if the endpoint checks first, but is a good safeguard.
            print(f"Task for {player_id} started but lock was already taken.")
            return

        await redis.hset(status_key, mapping={
            "status": "progress", "message": "Initializing...", "processed": 0, "total": 100
        })

        async with httpx.AsyncClient() as client:
            # 2. Fetch PUUID
            await redis.hset(status_key, "message", "Fetching player identity...")
            puuid = await riot_api_client.get_puuid(client, game_name, tag_line, region)

            # 3. Fetch Match IDs
            await redis.hset(status_key, "message", f"Fetching up to {config.GAMES_TO_FETCH} match IDs...")
            all_match_ids = []
            start_index = 0
            while len(all_match_ids) < config.GAMES_TO_FETCH:
                count_to_fetch = min(100, config.GAMES_TO_FETCH - len(all_match_ids))
                chunk_match_ids = await riot_api_client.get_match_ids_async(
                    client, puuid, count_to_fetch, start_index, region
                )
                
                if not chunk_match_ids:
                    # No more matches found in the player's history
                    break
                    
                all_match_ids.extend(chunk_match_ids)
                start_index += len(chunk_match_ids)
                
                # Update status with the number of IDs found so far
                await redis.hset(status_key, "message", f"Found {len(all_match_ids)} match IDs so far...")

                if len(chunk_match_ids) < 100:
                    # Last page of matches was reached
                    break
                
                await asyncio.sleep(config.API_REQUEST_DELAY_SECONDS)
            
            if not all_match_ids:
                await redis.hset(status_key, mapping={"status": "complete", "message": "No recent games found."})
                return

            # 4. Fetch Match Details
            total_matches = len(all_match_ids)
            # Use individual hset calls to avoid overwriting other fields
            await redis.hset(status_key, "message", "Fetching match details...")
            await redis.hset(status_key, "total", total_matches)
            await redis.hset(status_key, "processed", 0) # Initialize processed count

            all_games_data = []
            for i, match_id in enumerate(all_match_ids):
                details = await riot_api_client.get_match_details_async(client, match_id, puuid, region)
                if details:
                    all_games_data.append(details)
                
                # CORRECTED: This now updates only the 'processed' field, leaving 'total' intact.
                await redis.hset(status_key, "processed", i + 1)
                await asyncio.sleep(config.API_REQUEST_DELAY_SECONDS)

            # 5. Process, Cache, and Set Cooldown
            all_games_data.sort(key=lambda x: x['timestamp'], reverse=True)
            redis_service.set_in_cache(cache_key, all_games_data)
            redis_service.set_cooldown(cooldown_key, config.COOLDOWN_SECONDS)
            
            # 6. Set Final Status
            await redis.hset(status_key, mapping={"status": "complete", "message": "Data successfully updated."})

    except riot_api_client.PlayerNotFound as e:
        await redis.hset(status_key, mapping={"status": "error", "message": str(e)})
    except Exception as e:
        print(f"An unexpected error occurred in task for {player_id}: {e}")
        await redis.hset(status_key, mapping={"status": "error", "message": "An unexpected server error occurred."})
    finally:
        # VERY IMPORTANT: Always release the lock
        redis_service.release_lock(lock_key)
        # Expire the status key after a few minutes so it doesn't live forever
        await redis.expire(status_key, 300)

# ARQ Worker Settings
class WorkerSettings:
    functions = [fetch_ranked_history_task]
    redis_settings = arq.connections.RedisSettings(host=config.REDIS_HOST, port=config.REDIS_PORT)

if __name__ == "__main__":
    import asyncio
    import sys
    from arq.worker import run_worker
    from watchfiles import run_process

    # This allows you to run with "python worker.py --watch"
    watch = '--watch' in sys.argv
    
    # Define the worker settings class name to be used by the runner
    worker_settings_name = "worker.WorkerSettings"
    
    if watch:
        print("Starting ARQ worker with --watch enabled...")
        # run_process watches the current directory for changes and restarts the process.
        # The target process is this same script, but without the --watch flag
        # to prevent an infinite loop of watchers.
        run_process(
            '.', 
            target=f'arq {worker_settings_name}', 
            callback=lambda _: print("Changes detected, restarting worker...")
        )
    else:
        print("Starting ARQ worker...")
        # If not watching, just run the worker directly.
        # This is what will run in production or inside the watch process.
        asyncio.run(run_worker(WorkerSettings))