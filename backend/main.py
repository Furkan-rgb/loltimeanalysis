import sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from arq.connections import create_pool, RedisSettings, ArqRedis

# Import our refactored modules
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
            RedisSettings(host=config.REDIS_HOST, port=config.REDIS_PORT, database=config.REDIS_DB)
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

# --- API ENDPOINTS ---

@app.post("/fetch-history/")
async def start_fetch_job(game_name: str, tag_line: str, region: str = "europe", force_update: bool = False):
    """
    Initiates a background job to fetch match history.
    This endpoint is non-blocking and returns a status immediately.
    """
    player_id = f"{game_name.lower()}#{tag_line.lower()}"
    cache_key = f"cache:{player_id}"
    cooldown_key = f"cooldown:{player_id}"
    lock_key = f"lock:{player_id}"

    # 1. Immediately return cached data if available and not forcing an update
    if not force_update:
        if cached_data := redis_service.get_from_cache(cache_key):
            print(f"CACHE HIT for {player_id}")
            return {"status": "cached", "data": cached_data}

    # 2. Check for cooldown
    if (ttl := redis_service.get_cooldown_ttl(cooldown_key)) > 0:
        raise HTTPException(status_code=429, detail=f"This player is on a cooldown. Please try again in {ttl} seconds.")

    # 3. Check if a job is already running (by checking for the lock key)
    if redis_service.redis_client.exists(lock_key):
         print(f"Fetch already in progress for {player_id}")
         return {"status": "in_progress"}

    # 4. Enqueue the new job for the ARQ worker
    print(f"Enqueuing fetch job for {player_id}")
    await arq_redis_pool.enqueue_job(
        'fetch_ranked_history_task', game_name, tag_line, region
    )
    return {"status": "started"}

@app.get("/fetch-status/")
def get_fetch_status(game_name: str, tag_line: str):
    """
    Poll this endpoint to get the status of a running fetch job.
    The frontend will call this repeatedly to update the UI.
    """
    player_id = f"{game_name.lower()}#{tag_line.lower()}"
    status_key = f"status:{player_id}"
    cache_key = f"cache:{player_id}"
    
    status_data = redis_service.redis_client.hgetall(status_key)
    
    if not status_data:
        # If no status is being reported, check if data exists in the cache
        # to determine if the user has fetched this player before.
        if redis_service.get_from_cache(cache_key):
            return {"status": "idle_data_exists"}
        return {"status": "idle_no_data"}
        
    # The worker stores numbers as strings, so convert them for the frontend
    if 'processed' in status_data:
        status_data['processed'] = int(status_data['processed'])
    if 'total' in status_data:
        status_data['total'] = int(status_data['total'])
        
    return status_data

# --- LOCAL DEVELOPMENT RUNNER ---
if __name__ == "__main__":
    import uvicorn
    # Note: reload=True is great for development but should be False in production.
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)