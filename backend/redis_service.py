import redis
import json
import config

# --- REDIS CLIENT INITIALIZATION ---
try:
    redis_client = redis.Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        db=config.REDIS_DB,
        decode_responses=True,
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

    Note: Data is stored as a ZSET (sorted set) where each member is JSON data
    and the score is a timestamp for chronological ordering.
    """
    if not redis_client:
        return None
    try:
        # Check what type of data structure this key holds
        key_type = redis_client.type(key)

        if key_type == "zset":
            # Data is stored as a sorted set, retrieve all members with scores
            # ZREVRANGE gets members in reverse order (newest first)
            zset_data = redis_client.zrevrange(key, 0, -1, withscores=False)
            if zset_data:
                # Each member in the ZSET is a JSON string, deserialize them
                return [json.loads(member) for member in zset_data]
            return None
        elif key_type == "string":
            # Legacy format: data stored as a JSON string
            cached_string = redis_client.get(key)
            if cached_string:
                return json.loads(cached_string)
            return None
        else:
            print(f"Redis key {key} has unexpected type: {key_type}")
            return None

    except redis.exceptions.RedisError as e:
        print(f"Redis GET error: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"JSON decode error for key {key}: {e}")
        return None


def set_in_cache(key: str, data: list | dict):
    """
    Serializes a Python object and stores it in Redis.

    For lists: Stores as a ZSET where each item gets a timestamp-based score
    For dicts: Stores as a simple JSON string
    """
    if not redis_client or not data:
        return
    try:
        if isinstance(data, list):
            # Store list items as a ZSET with timestamp-based scoring
            # This maintains chronological order and consistency with task storage
            import time

            current_time = time.time()

            # Clear any existing data first
            redis_client.delete(key)

            # Add each item to the sorted set
            zset_data = {}
            for i, item in enumerate(data):
                # Use incrementing timestamps to maintain order
                score = current_time + i
                zset_data[json.dumps(item, default=str)] = score

            if zset_data:
                redis_client.zadd(key, zset_data)
                redis_client.expire(key, config.CACHE_EXPIRATION_SECONDS)
                print(f"Stored {len(data)} items in ZSET for {key}")
        else:
            # For non-list data, store as JSON string (legacy format)
            data_to_cache = json.dumps(data, default=str)
            redis_client.setex(key, config.CACHE_EXPIRATION_SECONDS, data_to_cache)
            print(f"Stored dict/object as JSON string for {key}")

    except redis.exceptions.RedisError as e:
        print(f"Redis SETEX/ZADD error: {e}")


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
        return -2  # Represents no cooldown, as key doesn't exist.
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
        return False  # Cannot acquire lock if Redis is down
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
