import redis
import json
import config

def get_redis_client():
    """
    Factory function to create and connect to Redis on-demand.
    This is safe to call from anywhere, including Temporal Activities.
    """
    try:
        client = redis.Redis(
            host=config.REDIS_HOST,
            port=config.REDIS_PORT,
            db=config.REDIS_DB,
            decode_responses=True,
        )
        client.ping()
        return client
    except redis.exceptions.ConnectionError as e:
        print(f"FATAL: Could not connect to Redis. {e}")
        # Re-raise the exception to make the calling function aware of the failure.
        raise

# --- CACHE INTERFACE FUNCTIONS ---
# Note: Every function now accepts 'redis_client' as its first argument.

def get_from_cache(redis_client, key: str) -> list | dict | None:
    if not redis_client: return None
    try:
        key_type = redis_client.type(key)
        if key_type == "zset":
            zset_data = redis_client.zrevrange(key, 0, -1, withscores=False)
            return [json.loads(member) for member in zset_data] if zset_data else None
        elif key_type == "string":
            cached_string = redis_client.get(key)
            return json.loads(cached_string) if cached_string else None
        else:
            print(f"Redis key {key} has unexpected type: {key_type}")
            return None
    except (redis.exceptions.RedisError, json.JSONDecodeError) as e:
        print(f"Redis/JSON error for key {key}: {e}")
        return None


def get_cached_match_ids(redis_client, key: str) -> set | None:
    """
    Efficiently returns a set of match_id strings currently cached at the given key.
    Returns None on error or if key doesn't exist.
    """
    if not redis_client:
        return None
    try:
        # If the cache key is a zset as used for match lists, iterate members and
        # extract match_id from the JSON. Using zrange/zrevrange returns list of
        # JSON strings which we can parse.
        key_type = redis_client.type(key)
        if key_type == "zset":
            members = redis_client.zrevrange(key, 0, -1, withscores=False)
            ids = set()
            for m in members:
                try:
                    obj = json.loads(m)
                    if isinstance(obj, dict) and obj.get("match_id"):
                        ids.add(obj.get("match_id"))
                except json.JSONDecodeError:
                    # Skip malformed member but continue processing others
                    continue
            return ids if ids else None
        elif key_type == "string":
            cached_string = redis_client.get(key)
            if not cached_string:
                return None
            data = json.loads(cached_string)
            if isinstance(data, list):
                return {item.get("match_id") for item in data if isinstance(item, dict) and item.get("match_id")}
            return None
        else:
            return None
    except (redis.exceptions.RedisError, json.JSONDecodeError) as e:
        print(f"Redis error while getting cached match ids for key {key}: {e}")
        return None

def set_in_cache(redis_client, key: str, data: list | dict):
    if not redis_client or not data: return
    try:
        if isinstance(data, list):
            import time
            current_time = time.time()
            redis_client.delete(key)
            zset_data = {
                json.dumps(item, default=str): current_time + i
                for i, item in enumerate(data)
            }
            if zset_data:
                redis_client.zadd(key, zset_data)
                redis_client.expire(key, config.CACHE_EXPIRATION_SECONDS)
        else:
            data_to_cache = json.dumps(data, default=str)
            redis_client.setex(key, config.CACHE_EXPIRATION_SECONDS, data_to_cache)
    except redis.exceptions.RedisError as e:
        print(f"Redis SETEX/ZADD error: {e}")

def set_cooldown(redis_client, key: str, cooldown_seconds: int = 120):
    if not redis_client: return
    try:
        redis_client.setex(key, cooldown_seconds, 1)
    except redis.exceptions.RedisError as e:
        print(f"Redis SETEX error for cooldown: {e}")

def get_cooldown_ttl(redis_client, key: str) -> int:
    """
    Checks the remaining time-to-live (TTL) for a cooldown key.
    Now accepts a redis_client instance.
    """
    if not redis_client:
        return -2
    try:
        return redis_client.ttl(key)
    except redis.exceptions.RedisError as e:
        print(f"Redis TTL error: {e}")
        return -2

def acquire_lock(redis_client, key: str, lock_timeout_seconds: int = 90) -> bool:
    """
    Tries to acquire a distributed lock in Redis.
    Now accepts a redis_client instance.
    """
    if not redis_client:
        return False
    return redis_client.set(key, 1, ex=lock_timeout_seconds, nx=True)

def release_lock(redis_client, key: str):
    """
    Releases a distributed lock in Redis.
    Now accepts a redis_client instance.
    """
    if not redis_client:
        return
    try:
        redis_client.delete(key)
    except redis.exceptions.RedisError as e:
        print(f"Redis DEL error for lock: {e}")