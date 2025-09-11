import redis
import json
import config

# --- REDIS CLIENT INITIALIZATION ---
try:
    redis_client = redis.Redis(
        host=config.REDIS_HOST, 
        port=config.REDIS_PORT, 
        db=config.REDIS_DB, 
        decode_responses=True
    )
    redis_client.ping()
    print("Successfully connected to Redis for synchronous operations.")
except redis.exceptions.ConnectionError as e:
    print(f"FATAL: Could not connect to Redis. {e}")
    # Re-raise the exception to halt the application startup.
    raise

# --- CACHE INTERFACE FUNCTIONS ---
def get_from_cache(key: str) -> list | dict | None:
    """
    Retrieves and deserializes data from Redis.
    Returns a Python object (list/dict) if found, otherwise None.
    """
    if not redis_client:
        return None
    try:
        cached_string = redis_client.get(key)
        if cached_string:
            # CHANGE: Deserialize the JSON string back into a Python object here.
            return json.loads(cached_string)
        return None
    except redis.exceptions.RedisError as e:
        print(f"Redis GET error: {e}")
        return None

def set_in_cache(key: str, data: list | dict):
    """
    Serializes a Python object to a JSON string and stores it in Redis.
    """
    if not redis_client or not data:
        return
    try:
        data_to_cache = json.dumps(data, default=str)
        redis_client.setex(key, config.CACHE_EXPIRATION_SECONDS, data_to_cache)
        print(f"Stored results for {key} in cache for {config.CACHE_EXPIRATION_SECONDS} seconds.")
    except redis.exceptions.RedisError as e:
        print(f"Redis SETEX error: {e}")

# In redis_cache.py, add these functions:

def set_cooldown(key: str, cooldown_seconds: int = 120):
    """
    Sets a cooldown flag in Redis for a specific key.
    The flag will automatically expire after the specified duration.
    """
    if not redis_client:
        return
    try:
        # We set the value to '1' with an expiration (EX) of 120 seconds.
        redis_client.setex(key, cooldown_seconds, 1)
        print(f"Cooldown set for {key} for {cooldown_seconds} seconds.")
    except redis.exceptions.RedisError as e:
        print(f"Redis SETEX error for cooldown: {e}")

def get_cooldown_ttl(key: str) -> int:
    """
    Checks the remaining time-to-live (TTL) for a cooldown key.
    Returns the number of seconds left, or -2 if the key doesn't exist.
    """
    if not redis_client:
        return -2 # Represents no cooldown, as key doesn't exist.
    try:
        # The TTL command returns the remaining seconds.
        return redis_client.ttl(key)
    except redis.exceptions.RedisError as e:
        print(f"Redis TTL error: {e}")
        return -2

def acquire_lock(key: str, lock_timeout_seconds: int = 90) -> bool:
    """
    Tries to acquire a distributed lock in Redis.
    Returns True if the lock was acquired, False otherwise.
    The 'nx=True' argument means "set only if the key does not already exist."
    """
    if not redis_client:
        return False # Cannot acquire lock if Redis is down
    # This is an atomic operation.
    return redis_client.set(key, 1, ex=lock_timeout_seconds, nx=True)

def release_lock(key: str):
    """Releases a distributed lock in Redis."""
    if not redis_client:
        return
    try:
        redis_client.delete(key)
    except redis.exceptions.RedisError as e:
        print(f"Redis DEL error for lock: {e}")