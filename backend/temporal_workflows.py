import asyncio
from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy

import key_service
import redis_service
import config

@workflow.defn
class FetchMatchHistoryWorkflow:
    def __init__(self) -> None:
        self._processed: int = 0
        self._total: int = 0
        self._error: str | None = None
        self._final_status: str | None = None

    @workflow.run
    async def run(self, game_name: str, tag_line: str, region: str) -> str:
        player_id = key_service.get_player_id(game_name, tag_line, region)
        cache_key = key_service.get_cache_key(player_id)
        lock_key = key_service.get_lock_key(player_id)
        cooldown_key = key_service.get_cooldown_key(player_id)

        # --- Heartbeat Logic ---
        # Extend the lock every 60 seconds. Must be less than the lock timeout.
        heartbeat_interval_seconds = 60
        # This should match config.LOCK_TIMEOUT_SECONDS
        lock_ttl_seconds = config.LOCK_TIMEOUT_SECONDS

        async def lock_heartbeat_task():
            """Runs in the background, extending the lock TTL."""
            while True:
                await workflow.sleep(heartbeat_interval_seconds)
                workflow.logger.info(f"Heartbeating lock for {player_id}")
                await workflow.execute_activity(
                    "extend_lock_activity",
                    args=[lock_key, lock_ttl_seconds],
                    start_to_close_timeout=timedelta(seconds=10),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )

        heartbeat_task = asyncio.create_task(lock_heartbeat_task())
        
        try:
            puuid = await workflow.execute_activity(
                "get_puuid_activity",
                args=[game_name, tag_line, region],
                start_to_close_timeout=timedelta(seconds=30),
            )
            
            match_ids = await workflow.execute_activity(
                "get_match_ids_activity",
                args=[puuid, region],
                start_to_close_timeout=timedelta(minutes=10),
                heartbeat_timeout=timedelta(seconds=30),
            )

            if not match_ids:
                self._final_status = "no_matches"
                return "Completed: No matches found."

            self._total = len(match_ids)
            
            fetch_tasks = []
            for match_id in match_ids:
                task = workflow.execute_activity(
                    "get_match_details_activity",
                    args=[match_id, puuid, region],
                    start_to_close_timeout=timedelta(minutes=5),
                )
                fetch_tasks.append(task)
            
            match_details_results = []
            for future in asyncio.as_completed(fetch_tasks):
                result = await future
                if result is not None:
                    match_details_results.append(result)
                self._processed += 1
                await workflow.sleep(0)
            
            match_details_results.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
            
            await workflow.execute_activity(
                "save_results_to_cache_activity",
                args=[cache_key, match_details_results],
                start_to_close_timeout=timedelta(seconds=30),
            )
            self._final_status = "completed"
            return f"Successfully processed {len(match_details_results)} matches."

        except Exception as e:
            workflow.logger.error(f"Workflow failed: {e}", exc_info=True)
            self._error = str(e)
            self._final_status = "failed"
            return f"Workflow failed: {e}"
        finally:
            # Always cancel the heartbeat task
            heartbeat_task.cancel()
            
            # Use a dedicated, reliable activity to release the lock and set the cooldown
            await workflow.execute_activity(
                "release_and_cleanup_activity",
                args=[lock_key, cooldown_key, config.COOLDOWN_SECONDS],
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )

    @workflow.query
    def get_status(self) -> dict:
        if self._final_status:
            if self._final_status == "failed":
                return {"status": "failed", "error": self._error}
            else:
                return {"status": self._final_status}
        else:
            return {
                "status": "progress",
                "processed": self._processed,
                "total": self._total,
            }
