import os
from dotenv import load_dotenv

load_dotenv()

# --- RIOT API ---
RIOT_API_KEY = os.getenv("RIOT_API_KEY")
GAMES_TO_FETCH = 500
API_REQUEST_DELAY_MS = 1250  # 1.25 seconds
API_REQUEST_DELAY_SECONDS = API_REQUEST_DELAY_MS / 1000.0
RATE_LIMIT_LOCK_KEY = "riot_api_rate_limit_lock"

# --- REDIS ---
REDIS_HOST = "localhost"
REDIS_PORT = 6379
REDIS_DB = 0

# --- CACHING & LOCKING ---
CACHE_EXPIRATION_SECONDS = 2592000  # 30 days
COOLDOWN_SECONDS = 120  # 2 minutes
LOCK_TIMEOUT_SECONDS = 300  # 5 minutes
