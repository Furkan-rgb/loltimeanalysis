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