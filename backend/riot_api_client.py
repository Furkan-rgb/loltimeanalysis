import httpx
from datetime import datetime
import config  # Import our new config file

HEADERS = {"X-Riot-Token": config.RIOT_API_KEY}


class PlayerNotFound(Exception):
    """Custom exception for when a player's PUUID can't be found."""

    pass


async def get_puuid(
    client: httpx.AsyncClient, game_name: str, tag_line: str, region: str = "europe"
) -> str:
    """Fetches a player's PUUID. Raises PlayerNotFound on 404."""
    url = f"https://{region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}"
    try:
        response = await client.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        if not data.get("puuid"):
            raise PlayerNotFound("PUUID not found in response.")
        return data["puuid"]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise PlayerNotFound(f"Player {game_name}#{tag_line} not found.") from e
        raise  # Re-raise other HTTP errors


async def get_match_ids_async(
    client: httpx.AsyncClient,
    puuid: str,
    count: int,
    start_index: int,
    region: str = "europe",
) -> list | None:
    """Asynchronously fetches a list of match IDs."""
    url = f"https://{region}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start={start_index}&count={count}"
    try:
        response = await client.get(url, headers=HEADERS)
        response.raise_for_status()
        return response.json()
    except httpx.RequestError as e:
        print(f"Error fetching match IDs: {e}")
        return None


async def get_match_details_async(
    client: httpx.AsyncClient, match_id: str, puuid: str, region: str = "europe"
) -> dict | None:
    """Asynchronously fetches detailed information for a single match."""
    url = f"https://{region}.api.riotgames.com/lol/match/v5/matches/{match_id}"
    try:
        response = await client.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        player_data = next(
            (p for p in data["info"]["participants"] if p["puuid"] == puuid), None
        )
        if player_data:
            return {
                "match_id": match_id,
                "timestamp": data["info"]["gameCreation"],
                "outcome": "Win" if player_data["win"] else "Loss",
                "champion": player_data["championName"],
                "role": player_data["teamPosition"],
            }
        return None
    except (httpx.RequestError, httpx.HTTPStatusError) as e:
        print(f"HTTP error fetching details for match {match_id}: {e}")
        return None
    except (KeyError, TypeError, ValueError) as e:
        print(f"Data parsing error for match {match_id}: {e}")
        return None
