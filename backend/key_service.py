# --- Static Keys ---
# This key is global and doesn't depend on a player.
RATE_LIMIT_LOCK_KEY = "riot_api_rate_limit_lock"


# --- Dynamic Key Generators ---
# These functions ensure a consistent format for all player-specific keys.

def get_player_id(game_name: str, tag_line: str, region: str) -> str:
    """Creates the standardized player identifier string."""
    return f"{game_name.lower()}#{tag_line.lower()}@{region.lower()}"

def get_lock_key(player_id: str) -> str:
    """Returns the Redis key for a player's job lock."""
    return f"lock:{player_id}"

def get_cooldown_key(player_id: str) -> str:
    """Returns the Redis key for a player's update cooldown."""
    return f"cooldown:{player_id}"

def get_cache_key(player_id: str) -> str:
    """Returns the Redis key for a player's final cached data."""
    return f"cache:{player_id}"

def get_error_key(player_id: str) -> str:
    """Returns the Redis key for storing a job's error message."""
    return f"job:{player_id}:error"

def get_aggregation_key(player_id: str) -> str:
    """Returns the Redis key for the job's progress-tracking hash."""
    return f"job:{player_id}:agg"

def get_partial_results_key(player_id: str) -> str:
    """Returns the Redis key for the job's temporary results set."""
    return f"job:{player_id}:results"