import os
from dotenv import load_dotenv

load_dotenv()

# --- RIOT API ---
RIOT_API_KEY = os.getenv("RIOT_API_KEY")
GAMES_TO_FETCH = 50
API_REQUEST_DELAY_SECONDS = 1.25

# --- REDIS ---
REDIS_HOST = "localhost"
REDIS_PORT = 6379
REDIS_DB = 0

# --- CACHING & LOCKING ---
CACHE_EXPIRATION_SECONDS = 2592000  # 30 days
COOLDOWN_SECONDS = 120
LOCK_TIMEOUT_SECONDS = 300 # 5 minutes