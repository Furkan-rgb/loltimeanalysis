import sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from arq.connections import create_pool, RedisSettings, ArqRedis
import asyncio
import json
from fastapi.responses import StreamingResponse
import config
import redis

try:
    # This import will now fail if the synchronous client can't connect
    import redis_service
except redis.exceptions.ConnectionError:
    # The error is already printed by redis_service, just exit.
    sys.exit(1)

# --- APP INITIALIZATION ---

# This global variable will hold the ARQ connection pool
arq_redis_pool: ArqRedis | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handles startup and shutdown events, ensuring critical connections
    are established before the application starts serving requests.
    """
    global arq_redis_pool
    print("FastAPI starting up: Checking critical connections...")
    try:
        # 1. Initialize ARQ connection pool
        arq_redis_pool = await create_pool(
            RedisSettings(
                host=config.REDIS_HOST, port=config.REDIS_PORT, database=config.REDIS_DB
            )
        )
        # 2. Verify the ARQ pool connection
        await arq_redis_pool.ping()
        print("Successfully connected to Redis for ARQ background tasks.")

    except (redis.exceptions.ConnectionError, TimeoutError) as e:
        print(f"FATAL: Could not establish ARQ connection to Redis: {e}")
        print("Application will not start.")
        sys.exit(1)

    # If all checks pass, yield to let the app run
    yield

    # Code to run on shutdown
    print("FastAPI shutting down: Closing ARQ connection pool...")
    if arq_redis_pool:
        await arq_redis_pool.close()


app = FastAPI(lifespan=lifespan)

# --- MIDDLEWARE ---

# Allow frontend requests from localhost
origins = ["http://localhost", "http://localhost:8080", "null"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/history/{game_name}/{tag_line}")
def get_history(game_name: str, tag_line: str):
    """
    Retrieves a player's match history directly from the cache.
    This is a simple, non-blocking read operation.
    """
    player_id = f"{game_name.lower()}#{tag_line.lower()}"
    cache_key = f"cache:{player_id}"

    if cached_data := redis_service.get_from_cache(cache_key):
        print(f"CACHE HIT for {player_id}")
        return {"status": "cached", "data": cached_data}

    # If no data is found in the cache, return a 404
    raise HTTPException(
        status_code=404,
        detail="No match history found for this player. Please trigger an update.",
    )


@app.post("/update/{game_name}/{tag_line}")
async def trigger_update_job(game_name: str, tag_line: str, region: str = "europe"):
    """
    Triggers a background job to fetch or update a player's match history.
    This is a non-blocking action endpoint.
    """
    player_id = f"{game_name.lower()}#{tag_line.lower()}"
    cooldown_key = f"cooldown:{player_id}"
    lock_key = f"lock:{player_id}"

    # 1. Check for cooldown
    if (ttl := redis_service.get_cooldown_ttl(cooldown_key)) > 0:
        raise HTTPException(
            status_code=429,  # Too Many Requests
            detail=f"This player is on a cooldown. Please try again in {ttl} seconds.",
        )

    # 2. Atomically acquire the lock
    if not redis_service.acquire_lock(lock_key, config.LOCK_TIMEOUT_SECONDS):
        print(f"Update already in progress for {player_id}")
        return {"status": "in_progress"}

    # 3. Enqueue the dispatcher job
    print(f"Lock acquired. Enqueuing dispatcher job for {player_id}")
    await arq_redis_pool.enqueue_job("dispatch_fetch_job", game_name, tag_line, region)
    return {"status": "started"}


@app.get("/stream-status/{game_name}/{tag_line}")
async def stream_status(game_name: str, tag_line: str):
    """
    Streams status updates using Server-Sent Events (SSE).
    This keeps a connection open and pushes data as the job progresses.
    """
    player_id = f"{game_name.lower()}#{tag_line.lower()}"

    async def event_generator():
        """Yields status updates as SSE messages."""
        last_status = None
        while True:
            # --- The logic to check Redis is the same as before ---
            lock_key = f"lock:{player_id}"
            aggregation_key = f"job:{player_id}:agg"
            cache_key = f"cache:{player_id}"

            current_status = {}
            status_data = redis_service.redis_client.hgetall(aggregation_key)

            if status_data:
                current_status = {
                    "status": "progress",
                    "processed": int(status_data.get("processed", 0)),
                    "total": int(status_data.get("total", 1)),
                }
            elif redis_service.redis_client.exists(lock_key):
                current_status = {"status": "progress", "processed": 0, "total": 100}
            elif redis_service.redis_client.exists(cache_key):
                current_status = {"status": "ready"}
            else:
                current_status = {"status": "idle_no_data"}

            # --- Push an update only if the status has changed ---
            if current_status != last_status:
                yield f"data: {json.dumps(current_status)}\n\n"
                last_status = current_status

            # If the job is done or not found, close the stream
            if current_status["status"] in ["ready", "idle_no_data"]:
                break

            await asyncio.sleep(1)  # Check for updates every second

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# --- LOCAL DEVELOPMENT RUNNER ---
if __name__ == "__main__":
    import uvicorn

    # Note: reload=True is great for development but should be False in production.
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
