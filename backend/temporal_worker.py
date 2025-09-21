# temporal_worker.py (Revised and Resilient Version)
import asyncio
import logging
import time
from temporalio.client import Client
from temporalio.worker import Worker

import config
import redis_service
from temporal_workflows import FetchMatchHistoryWorkflow
from activities import (
    get_puuid_activity,
    get_match_ids_activity,
    get_match_details_activity,
    save_results_to_cache_activity,
    extend_lock_activity,
    release_and_cleanup_activity,
)

logging.basicConfig(level=logging.INFO)

# --- NEW: Health Heartbeat ---
HEARTBEAT_KEY = f"worker:heartbeat:{config.TEMPORAL_TASK_QUEUE}"

async def periodic_heartbeat(redis_client: redis_service.redis.Redis, interval_seconds: int = 30):
    """A background task to write a heartbeat to Redis periodically."""
    while True:
        try:
            redis_client.set(HEARTBEAT_KEY, time.time(), ex=interval_seconds * 2)
            logging.info(f"Worker heartbeat sent to Redis key '{HEARTBEAT_KEY}'.")
        except redis_service.redis.exceptions.RedisError as e:
            logging.error(f"Could not send worker heartbeat: {e}")
        await asyncio.sleep(interval_seconds)

async def main():
    client = None
    last_exception = None
    
    # --- MODIFICATION: Connect to Redis first for the heartbeat ---
    try:
        redis_for_heartbeat = redis_service.get_redis_client()
        logging.info("Successfully connected to Redis for worker heartbeat.")
    except Exception as e:
        logging.error(f"FATAL: Worker could not connect to Redis: {e}")
        return # Exit if Redis isn't available

    for attempt in range(10):
        try:
            client = await Client.connect(f"{config.TEMPORAL_HOST}:7233")
            logging.info("Successfully connected to Temporal server.")
            last_exception = None
            break
        except Exception as e:
            last_exception = e
            logging.warning(
                f"Connection to Temporal failed with {type(e).__name__}: {e}. "
                f"Retrying in 3 seconds... (Attempt {attempt + 1}/10)"
            )
            await asyncio.sleep(3)

    if last_exception:
        logging.error("Could not connect to Temporal server after multiple retries.")
        raise last_exception

    # --- MODIFICATION: Start heartbeat task ---
    heartbeat_task = asyncio.create_task(periodic_heartbeat(redis_for_heartbeat))

    try:
        worker = Worker(
            client,
            # --- MODIFICATION: Use task queue from config ---
            task_queue=config.TEMPORAL_TASK_QUEUE,
            workflows=[FetchMatchHistoryWorkflow],
            activities=[
                get_puuid_activity,
                get_match_ids_activity,
                get_match_details_activity,
                save_results_to_cache_activity,
                extend_lock_activity,
                release_and_cleanup_activity,
            ],
            max_concurrent_activities=1,
        )
        logging.info("Temporal worker started, listening for tasks...")
        await worker.run()
    finally:
        # --- MODIFICATION: Graceful shutdown ---
        heartbeat_task.cancel()
        if client:
            await client.disconnect()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            logging.info("Heartbeat task successfully cancelled.")
        logging.info("Temporal worker shut down gracefully.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, Exception) as err:
        if not isinstance(err, KeyboardInterrupt):
            logging.error(f"Worker failed with an unhandled exception: {err}")
        print("\nTemporal worker shutting down.")