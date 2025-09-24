import os
from dotenv import load_dotenv

# This will load the .env file only if the variables are not already set
# (e.g., by docker-compose). It's safe to run everywhere.
load_dotenv()

# --- RIOT API ---
RIOT_API_KEY = os.getenv("RIOT_API_KEY")
GAMES_TO_FETCH = 500
API_REQUEST_DELAY_SECONDS = 1.25
API_REQUEST_DELAY_MS = int(API_REQUEST_DELAY_SECONDS * 1000)

# --- REDIS & TEMPORAL ---
# Provides a default of 'localhost' for local development
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
TEMPORAL_HOST = os.getenv('TEMPORAL_HOST', 'localhost')
REDIS_PORT = 6379
REDIS_DB = 0

# --- CACHING & LOCKING ---
CACHE_EXPIRATION_SECONDS = 15552000  # 180 days
COOLDOWN_SECONDS = 60  # 1 hour
LOCK_TIMEOUT_SECONDS = 300  # 5 minutes

# --- TEMPORAL TASK QUEUE ---
TEMPORAL_TASK_QUEUE = "match-history-task-queue"
INTERNAL_TASK_QUEUE = "internal-tasks"