import sys
import json
import asyncio
import logging
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager
from temporalio.client import Client, WorkflowExecutionStatus
from temporalio.exceptions import WorkflowAlreadyStartedError
import redis
import httpx
from schemas import ProgressState, CompletedState, FailedState, NoMatchesState
from fastapi import status, Response
from temporalio.api.enums.v1 import TaskQueueType
import time
import config
import redis_service
import key_service
from temporal_workflows import FetchMatchHistoryWorkflow
import riot_api_client

# --- APP INITIALIZATION ---
temporal_client: Client | None = None
redis_client: redis.Redis | None = None
logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global temporal_client, redis_client
    logging.info("FastAPI starting up...")

    # --- MODIFICATION START ---
    # Retry connecting to the Temporal server to avoid race conditions on startup
    max_retries = 10
    retry_delay = 3  # seconds
    for attempt in range(max_retries):
        try:
            temporal_client = await Client.connect(f"{config.TEMPORAL_HOST}:7233")
            logging.info("Successfully connected to Temporal server.")
            break  # Exit loop on success
        except Exception as e:
            if attempt < max_retries - 1:
                logging.warning(
                    f"Connection to Temporal failed with {type(e).__name__}: {e}. "
                    f"Retrying in {retry_delay} seconds... (Attempt {attempt + 1}/{max_retries})"
                )
                await asyncio.sleep(retry_delay)
            else:
                logging.error("FATAL: Could not connect to Temporal server after multiple retries.")
                sys.exit(1) # Exit if all retries fail
    # --- MODIFICATION END ---

    try:
        # Connect to Redis (can also have a retry loop if needed, but it's usually faster)
        redis_client = redis_service.get_redis_client()
        logging.info("Successfully connected to Redis server.")
    except Exception as e:
        logging.error(f"FATAL: Could not connect to Redis: {e}")
        sys.exit(1)

    yield # Application runs here

    logging.info("FastAPI shutting down.")
    if temporal_client:
        await temporal_client.disconnect()

app = FastAPI(lifespan=lifespan)

# --- DEPENDENCY ---
def get_redis() -> redis.Redis:
    """Dependency to provide the Redis client to routes."""
    if redis_client is None:
        raise HTTPException(status_code=503, detail="Redis connection not available")
    return redis_client

# --- MIDDLEWARE ---
origins = ["http://localhost", "http://localhost:8080", "http://localhost:5173"]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# --- ENDPOINTS ---
@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check(r: redis.Redis = Depends(get_redis)):
    """
    Performs a comprehensive health check on all critical dependencies.
    Returns 200 OK if all healthy, 503 Service Unavailable otherwise.
    """
    if not temporal_client:
        raise HTTPException(status_code=503, detail="Temporal client not initialized.")

    try:
        # 1. Check Redis connection
        if not r.ping():
            raise HTTPException(status_code=503, detail="Redis connection failed (ping).")

        # 2. Check Temporal gRPC connection
        await temporal_client.check_health()

        # 3. Check for active Temporal workers polling the task queue
        task_queue_name = config.TEMPORAL_TASK_QUEUE
        tq_desc = await temporal_client.workflow_service.describe_task_queue(
            namespace="default",
            task_queue={"name": task_queue_name, "kind": TaskQueueType.WORKFLOW},
        )
        if not tq_desc.pollers:
            raise HTTPException(
                status_code=503,
                detail=f"No active workers found on task queue '{task_queue_name}'.",
            )
        
        # 4. Check for a recent Temporal worker heartbeat in Redis
        heartbeat_key = f"worker:heartbeat:{task_queue_name}"
        heartbeat_ttl_seconds = 60

        heartbeat_timestamp = r.get(heartbeat_key)
        if not heartbeat_timestamp:
            raise HTTPException(
                status_code=503,
                detail=f"Temporal worker heartbeat missing from Redis key '{heartbeat_key}'.",
            )
        
        time_since_heartbeat = time.time() - float(heartbeat_timestamp)
        if time_since_heartbeat > heartbeat_ttl_seconds:
             raise HTTPException(
                status_code=503,
                detail=f"Temporal worker heartbeat is stale ({int(time_since_heartbeat)}s old).",
            )

    except Exception as e:
        # Catch any failure during the checks and report it as a service unavailable
        raise HTTPException(status_code=503, detail=f"Health check failed: {e}")

    return {
        "status": "ok",
        "services": ["redis", "temporal_connection", "temporal_worker_pollers", "temporal_worker_heartbeat"]
    }


@app.get("/history/{game_name}/{tag_line}/{region}")
async def get_history(game_name: str, tag_line: str, region: str, r: redis.Redis = Depends(get_redis)):
    """
    Checks for cached match history. If not found, validates player existence.
    - Returns 200 OK with data if cached.
    - Returns 204 No Content if the player is valid but has no cache.
    - Returns 404 Not Found if the player does not exist.
    """
    player_id = key_service.get_player_id(game_name, tag_line, region)
    cache_key = key_service.get_cache_key(player_id)
    lock_key = key_service.get_lock_key(player_id)

    if cached_data := redis_service.get_from_cache(r, cache_key):
        # Also indicate if an update is currently in progress for this player so clients
        # can automatically attach to the SSE stream and show live progress.
        in_progress = bool(r.exists(lock_key))
        return {"status": "cached", "data": cached_data, "in_progress": in_progress}

    try:
        async with httpx.AsyncClient() as client:
            await riot_api_client.validate_player_in_region_async(client, game_name, tag_line, region)
        
        return Response(status_code=204)

    except riot_api_client.PlayerNotFound as e:
        # This will now catch both "player doesn't exist" and "player not in this region"
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/update/{game_name}/{tag_line}/{region}")
async def trigger_update_job(game_name: str, tag_line: str, region: str, r: redis.Redis = Depends(get_redis)):
    player_id = key_service.get_player_id(game_name, tag_line, region)
    cooldown_key = key_service.get_cooldown_key(player_id)
    lock_key = key_service.get_lock_key(player_id)

    # If a cooldown is active and no update is currently running, refuse.
    # But if there's an in-progress lock, allow attaching to that update (don't return 429).
    if (ttl := redis_service.get_cooldown_ttl(r, cooldown_key)) > 0 and not r.exists(lock_key):
        # Return a structured response so clients can reliably parse cooldown and in-progress state.
        # We'll use HTTPException with a JSON-able detail.
        raise HTTPException(status_code=429, detail={
            "message": f"Please try again in {ttl} seconds.",
            "cooldown_seconds": ttl,
            "in_progress": False,
        })

    # Try to acquire an in-progress lock before starting the workflow. This prevents
    # multiple concurrent starts for the same player. The worker will release the lock
    # and set the cooldown when it finishes.
    acquired = redis_service.acquire_lock(r, lock_key, lock_timeout_seconds=config.LOCK_TIMEOUT_SECONDS)
    if not acquired:
        # Another update is already in progress. Let the caller know so they can attach via SSE.
        return {"status": "in_progress"}

    # We acquired the lock; now try to start the workflow. If starting fails, release the lock.
    try:
        await temporal_client.start_workflow(
            FetchMatchHistoryWorkflow.run,
            args=[game_name, tag_line, region],
            id=player_id,
            task_queue="match-history-task-queue",
        )
        return {"status": "started"}
    except WorkflowAlreadyStartedError:
        # The workflow was already started by another concurrent request. Release our lock
        # to avoid leaving it set and return in_progress so clients can attach to SSE.
        try:
            redis_service.release_lock(r, lock_key)
        except Exception:
            pass
        return {"status": "in_progress"}
    except Exception as e:
        # If workflow fails to start, release the lock so subsequent attempts can proceed.
        try:
            redis_service.release_lock(r, lock_key)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stream-status/{game_name}/{tag_line}/{region}")
async def stream_status(game_name: str, tag_line: str, region: str, r: redis.Redis = Depends(get_redis)):
    player_id = key_service.get_player_id(game_name, tag_line, region)

    async def event_generator():
        # First, patiently wait for the workflow handle to exist.
        handle = None
        for _ in range(10): # Try for 10 seconds
            try:
                handle = temporal_client.get_workflow_handle(player_id)
                break
            except Exception:
                await asyncio.sleep(1)
        
        # If it never appeared, the update failed to start.
        if not handle:
            cache_key = key_service.get_cache_key(player_id)
            model = CompletedState() if r.exists(cache_key) else FailedState(error="Update process failed to start.")
            yield f"data: {model.model_dump_json()}\n\n"
            return

        # Now, stream status from the handle we found.
        try:
            while True:
                status_model = None
                try:
                    # This block is now protected from transient Temporal errors.
                    desc = await handle.describe()

                    if desc.status == WorkflowExecutionStatus.RUNNING:
                        query_result = await handle.query(FetchMatchHistoryWorkflow.get_status)
                        if query_result.get("status") == "progress":
                            status_model = ProgressState(
                                status="progress",
                                processed=query_result.get("processed", 0),
                                total=query_result.get("total", 0)
                            )
                    elif desc.status == WorkflowExecutionStatus.COMPLETED:
                        status_model = CompletedState(status="completed")
                    else: # FAILED, TIMED_OUT, CANCELED
                        status_model = FailedState(status="failed",error=f"Workflow ended with status: {desc.status.name}")

                except Exception as e:
                    logging.warning(f"Error during stream for {player_id}: {e}. Retrying...")
                    # Don't set a status_model, just let the loop sleep and try again.

                if status_model:
                    yield f"data: {status_model.model_dump_json()}\n\n"

                # If the workflow reached a terminal state, stop streaming.
                if 'desc' in locals() and desc.status not in [WorkflowExecutionStatus.RUNNING]:
                    break
                
                await asyncio.sleep(1)

        except asyncio.CancelledError:
            logging.info(f"Client disconnected for stream {player_id}.")
        finally:
            logging.info(f"Closing stream generator for {player_id}.")

    return StreamingResponse(event_generator(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)