# LoL Time Analysis - Architecture Overview

## System Components

### 1. **Frontend (Web Interface)**

- `frontend/index.html` - Simple web interface for user requests
- Users input: Game Name, Tag Line, Region

### 2. **Backend API (FastAPI)**

- `backend/main.py` - REST API server
- Handles HTTP requests from frontend
- Manages job dispatch and status checking
- Connects to Redis for caching and job coordination

### 3. **Background Worker (ARQ)**

- `backend/worker.py` - Async task worker
- Processes background jobs using ARQ (Async Redis Queue)
- Executes three main task types:
  - `dispatch_fetch_job` - Job coordinator
  - `fetch_match_details_task` - Individual match processor
  - `aggregate_results_task` - Final data aggregator

### 4. **Redis Database**

- **Caching Layer**: Stores final results (`cache:{player_id}`)
- **Job Queue**: ARQ task queue (`arq:queue`, `arq:result:*`)
- **Coordination**: Job state tracking (`job:{player_id}:agg`)
- **Rate Limiting**: Global API rate limit locks
- **Locking**: Prevents duplicate job processing

### 5. **External API Client**

- `backend/riot_api_client.py` - Riot Games API interface
- Fetches player data and match history
- Handles rate limiting and error management

## Process Flow

```
┌─────────────────┐    HTTP Request     ┌─────────────────┐
│   Web Frontend  │ ────────────────► │   FastAPI App   │
│   (index.html)  │                    │   (main.py)     │
└─────────────────┘                    └─────────────────┘
                                                │
                                                │ Check Cache/Cooldown
                                                ▼
                                       ┌─────────────────┐
                                       │      Redis      │
                                       │   (Database)    │
                                       └─────────────────┘
                                                │
                                                │ If no cache, enqueue job
                                                ▼
                                       ┌─────────────────┐
                                       │   ARQ Queue     │
                                       │ (Task System)   │
                                       └─────────────────┘
                                                │
                                                │ Worker picks up job
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ARQ WORKER PROCESS                                │
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │  DISPATCHER     │    │    FETCHERS     │    │   AGGREGATOR    │        │
│  │                 │    │                 │    │                 │        │
│  │ 1. Get PUUID    │───►│ 2. Process Each │───►│ 3. Combine &    │        │
│  │ 2. Get Match    │    │    Match (879x) │    │    Cache Results│        │
│  │    IDs (879)    │    │                 │    │                 │        │
│  │ 3. Fan-out      │    │ Rate Limited    │    │ 4. Cleanup      │        │
│  │    Tasks        │    │ API Calls       │    │                 │        │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘        │
│           │                       │                       │                │
│           ▼                       ▼                       ▼                │
│  ┌─────────────────────────────────────────────────────────────────┐      │
│  │                     REDIS COORDINATION                          │      │
│  │                                                                 │      │
│  │  job:{player}:agg     │  job:{player}:results  │  arq:queue    │      │
│  │  ├─ total: 879       │  ├─ match_1_data       │  ├─ pending   │      │
│  │  ├─ processed: 0     │  ├─ match_2_data       │  │   tasks     │      │
│  │  └─ player_id        │  └─ ... (879 items)    │  └─ ...       │      │
│  └─────────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                           ┌─────────────────┐
                           │   Riot Games    │
                           │      API        │
                           └─────────────────┘
```

## Detailed Process Flow

### Phase 1: Request Handling

1. **User Request**: Frontend sends player info to FastAPI
2. **Cache Check**: API checks Redis for existing data
3. **Cooldown Check**: Ensures user hasn't requested recently
4. **Lock Check**: Prevents duplicate processing
5. **Job Dispatch**: If no cache, enqueue `dispatch_fetch_job`

### Phase 2: Job Dispatch (Fan-Out Pattern)

```python
dispatch_fetch_job(game_name, tag_line, region)
├─ Get PUUID from Riot API
├─ Fetch match IDs (up to 1000 matches)
├─ Create aggregation state in Redis
│   └─ job:{player}:agg {total: 879, processed: 0}
└─ Enqueue 879 individual fetch_match_details_task jobs
```

### Phase 3: Parallel Match Processing (Worker Pool)

```python
fetch_match_details_task(match_id, puuid, region, agg_key, results_key)
├─ Acquire rate limit lock (1.25s delay between API calls)
├─ Fetch match details from Riot API
├─ Store result in Redis list (job:{player}:results)
├─ Increment processed counter atomically
└─ If last task (processed == total):
    └─ Trigger aggregate_results_task
```

### Phase 4: Final Aggregation (Fan-In Pattern)

```python
aggregate_results_task(agg_key, results_key, player_id)
├─ Collect all results from Redis list
├─ Sort by timestamp (newest first)
├─ Save to main cache (cache:{player_id})
├─ Set cooldown timer
└─ Cleanup temporary job keys
```

## Key Architectural Patterns

### 1. **Fan-Out/Fan-In Pattern**

- **Fan-Out**: Dispatcher splits work into many small tasks
- **Fan-In**: Aggregator combines all results
- **Coordination**: Redis atomic counters track progress

### 2. **Rate Limiting Strategy**

- Global rate limit lock shared across all workers
- Prevents API rate limit violations
- 1.25 second delay between API calls

### 3. **Fault Tolerance**

- Jobs persist in Redis if worker crashes
- Atomic operations prevent race conditions
- Lock timeouts prevent indefinite blocking

### 4. **Caching Strategy**

- Results cached for 30 days
- Cooldown period prevents spam requests
- Immediate response for cached data

## Data Flow

```
Input: "BlearHunter#8100" → PUUID → [match_1, match_2, ..., match_879]
                                         ↓
Each match → {timestamp, duration, champion, kda, ...}
                                         ↓
Final output: Sorted array of 879 match objects
```

## Redis Key Structure

```
cache:{player_id}           # Final cached results (30 days)
cooldown:{player_id}        # Cooldown timer (2 minutes)
lock:{player_id}            # Job processing lock (5 minutes)
job:{player_id}:agg         # Job coordination state
job:{player_id}:results     # Temporary match results list
arq:queue                   # ARQ task queue
arq:result:{job_id}         # Completed job results
riot_api_rate_limit_lock    # Global API rate limiter
```

## Scaling Considerations

- **Horizontal**: Multiple worker processes can run simultaneously
- **Rate Limiting**: Global lock ensures API compliance
- **Memory**: Large jobs (1000 matches) use Redis for storage
- **Fault Recovery**: Incomplete jobs need manual cleanup (current limitation)

## Current Known Issues

1. **Stuck Jobs**: If worker crashes mid-job, incomplete state remains in Redis
2. **No Auto-Resume**: Worker doesn't automatically detect/resume incomplete jobs on startup
3. **Manual Cleanup**: Requires manual intervention to clean stuck job states
