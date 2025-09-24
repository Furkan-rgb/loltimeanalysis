import asyncio
from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy, Priority

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
        INTERNAL_TASK_QUEUE = config.INTERNAL_TASK_QUEUE

        # --- Heartbeat Logic ---
        # We'll extend the lock periodically from the main workflow logic
        # rather than spawning a background asyncio task. Spawning raw
        # asyncio tasks inside a Temporal workflow breaks determinism
        # and can cause replay issues. Use the workflow clock instead.
        heartbeat_interval_seconds = 60
        lock_ttl_seconds = config.LOCK_TIMEOUT_SECONDS
        # Track when we last extended the lock using the workflow clock.
        last_heartbeat_time = workflow.now()
        
        try:
            puuid = await workflow.execute_activity(
                "get_puuid_activity",
                args=[game_name, tag_line, region],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
            
            match_ids = await workflow.execute_activity(
                "get_match_ids_activity",
                args=[puuid, region],
                start_to_close_timeout=timedelta(minutes=10),
                heartbeat_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

            if not match_ids:
                self._final_status = "no_matches"
                return "Completed: No matches found."
            self._total = len(match_ids)

            # Filter cached matches so we only fetch details for missing IDs
            filter_result = await workflow.execute_activity(
                "filter_cached_matches_activity",
                args=[key_service.get_cache_key(player_id), match_ids],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

            existing_matches = filter_result.get("existing", []) or []
            missing_ids = filter_result.get("missing_ids", []) or []

            # Count cached items as already processed for progress reporting
            self._processed = len(existing_matches)

            fetch_tasks = []
            for match_id in missing_ids:
                task = workflow.execute_activity(
                    "get_match_details_activity",
                    args=[match_id, puuid, region],
                    start_to_close_timeout=timedelta(minutes=5),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
                fetch_tasks.append(task)
            
            match_details_results = []
            for future in asyncio.as_completed(fetch_tasks):
                result = await future
                if result is not None:
                    match_details_results.append(result)

                # Update processed count for the query hook.
                self._processed += 1

                # Periodically extend the external Redis lock so it doesn't
                # expire while we're still processing. Use the workflow
                # clock to decide when to extend.
                now = workflow.now()
                elapsed = (now - last_heartbeat_time).total_seconds()
                if elapsed >= heartbeat_interval_seconds:
                    workflow.logger.info(f"Extending lock for {player_id} after {int(elapsed)}s")
                    await workflow.execute_activity(
                        "extend_lock_activity",
                        args=[lock_key, lock_ttl_seconds],
                        start_to_close_timeout=timedelta(seconds=10),
                        retry_policy=RetryPolicy(maximum_attempts=3),
                        task_queue=INTERNAL_TASK_QUEUE,
                    )
                    last_heartbeat_time = workflow.now()

                # Yield control to the workflow runtime to keep things cooperative.
                await workflow.sleep(0)
            
            # Merge cached and newly fetched results. Deduplicate on match_id.
            combined = []
            seen = set()
            # Add newly fetched first (they're more likely to be fresh), then cached ones
            for item in (match_details_results + existing_matches):
                mid = item.get("match_id") if isinstance(item, dict) else None
                if not mid or mid in seen:
                    continue
                seen.add(mid)
                combined.append(item)

            combined.sort(key=lambda x: x.get("timestamp", 0), reverse=True)

            await workflow.execute_activity(
                "save_results_to_cache_activity",
                args=[cache_key, combined],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
                task_queue=INTERNAL_TASK_QUEUE,
            )
            self._final_status = "completed"
            return f"Successfully processed {len(match_details_results)} matches."

        except Exception as e:
            workflow.logger.error(f"Workflow failed: {e}", exc_info=True)
            self._error = str(e)
            self._final_status = "failed"
            return f"Workflow failed: {e}"
        finally:
            # No background heartbeat task to cancel; lock cleanup is handled
            # via the dedicated activity in the finally block below.
            
            # Use a dedicated, reliable activity to release the lock and set the cooldown
            await workflow.execute_activity(
                "release_and_cleanup_activity",
                args=[lock_key, cooldown_key, config.COOLDOWN_SECONDS],
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=RetryPolicy(maximum_attempts=5),
                task_queue=INTERNAL_TASK_QUEUE,
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
