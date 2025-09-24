import asyncio
from temporalio import activity

import redis_service
import riot_api_client
import config
import key_service

@activity.defn
async def get_puuid_activity(game_name: str, tag_line: str, region: str) -> str:
    """Activity to fetch a player's PUUID from the Riot API."""
    async with riot_api_client.httpx.AsyncClient() as client:
        return await riot_api_client.get_puuid(client, game_name, tag_line, region)

@activity.defn
async def get_match_ids_activity(puuid: str, region: str) -> list[str]:
    """Activity to fetch a list of match IDs for a given PUUID."""
    all_match_ids = []
    start_index = 0
    async with riot_api_client.httpx.AsyncClient() as client:
        while len(all_match_ids) < config.GAMES_TO_FETCH:
            activity.heartbeat()
            if activity.is_cancelled():
                activity.log.info("Activity cancelled.")
                raise asyncio.CancelledError("Activity was cancelled.")
            count_to_fetch = min(100, config.GAMES_TO_FETCH - len(all_match_ids))
            chunk = await riot_api_client.get_match_ids_async(
                client, puuid, count_to_fetch, start_index, region
            )
            if not chunk: break
            all_match_ids.extend(chunk)
            start_index += len(chunk)
            if len(chunk) < 100: break
            await asyncio.sleep(config.API_REQUEST_DELAY_SECONDS)
    return all_match_ids


@activity.defn
async def get_match_details_activity(match_id: str, puuid: str, region: str) -> dict | None:
    """Activity to fetch details for a single match."""
    try:
        async with riot_api_client.httpx.AsyncClient(timeout=15.0) as client:
            result = await riot_api_client.get_match_details_async(client, match_id, puuid, region)
            await asyncio.sleep(config.API_REQUEST_DELAY_SECONDS)
            return result
    except Exception as e:
        activity.log.error(f"Failed to get details for match {match_id}: {e}", exc_info=True)
        return None
    
@activity.defn
async def save_results_to_cache_activity(cache_key: str, results: list):
    """Saves the final results list to the specified cache key."""
    activity.logger.info(f"Saving {len(results)} matches to cache key '{cache_key}'")
    try:
        redis_client = redis_service.get_redis_client()
        redis_service.set_in_cache(redis_client, cache_key, results)
        activity.logger.info("Successfully saved results to Redis.")
    except Exception as e:
        activity.logger.error(f"Failed to save results to Redis: {e}", exc_info=True)
        raise


@activity.defn
async def filter_cached_matches_activity(cache_key: str, candidate_match_ids: list[str]) -> dict:
    """
    Returns a dict containing cached match objects for IDs present in cache and
    a list of missing match IDs that need to be fetched.

    Response shape: {"existing": [match_obj,...], "missing_ids": [id,...]}
    """
    redis_client = None
    try:
        redis_client = redis_service.get_redis_client()
        cached_ids = redis_service.get_cached_match_ids(redis_client, cache_key) or set()

        # Find which IDs are missing
        missing = [mid for mid in candidate_match_ids if mid not in cached_ids]

        # Load full cached objects for existing ids (if any)
        existing_objs = []
        if cached_ids:
            cached_list = redis_service.get_from_cache(redis_client, cache_key) or []
            # Build a map for quick lookup
            id_map = {item.get("match_id"): item for item in cached_list if isinstance(item, dict) and item.get("match_id")}
            for mid in candidate_match_ids:
                if mid in id_map:
                    existing_objs.append(id_map[mid])

        return {"existing": existing_objs, "missing_ids": missing}

    except Exception as e:
        activity.log.error(f"Error filtering cached matches for key {cache_key}: {e}", exc_info=True)
        # Re-raise so Temporal retry policy can handle transient problems
        raise


@activity.defn
async def extend_lock_activity(lock_key: str, extend_by_seconds: int) -> bool:
    """
    Activity to extend the TTL of a Redis key (the lock).
    This acts as a heartbeat to prevent the lock from expiring during long operations.
    """
    redis_client = None
    try:
        redis_client = redis_service.get_redis_client()
        # The EXPIRE command in Redis resets the timeout on a key.
        # It returns 1 if the timeout was set, and 0 if the key does not exist.
        # We return this boolean to the workflow, though it's not currently used.
        was_extended = redis_client.expire(lock_key, extend_by_seconds)
        if not was_extended:
            activity.logger.warning(f"Attempted to extend a lock that no longer exists: {lock_key}")
        return bool(was_extended)
    except Exception as e:
        activity.logger.error(f"Failed to extend lock for {lock_key}: {e}")
        # Re-raise the exception to let Temporal's retry policy handle it.
        raise


@activity.defn
async def release_and_cleanup_activity(lock_key: str, cooldown_key: str, cooldown_seconds: int):
    """
    Atomically releases the lock and sets the post-update cooldown.
    This is called from the workflow's 'finally' block to ensure cleanup.
    """
    redis_client = None
    try:
        redis_client = redis_service.get_redis_client()
        
        # Using a pipeline ensures that both commands are sent to Redis together,
        # reducing the chance of a failure between the two operations.
        pipe = redis_client.pipeline()
        
        # 1. Delete the in-progress lock.
        pipe.delete(lock_key)
        
        # 2. Set the cooldown to prevent another immediate update.
        pipe.setex(cooldown_key, cooldown_seconds, "1")
        
        # Execute both commands.
        pipe.execute()
        
        activity.logger.info(f"Released lock '{lock_key}' and set cooldown '{cooldown_key}'.")
    except Exception as e:
        activity.logger.error(f"Failed to release lock and set cooldown for {lock_key}: {e}")
        # Re-raise to allow Temporal to retry this critical cleanup step.
        raise
