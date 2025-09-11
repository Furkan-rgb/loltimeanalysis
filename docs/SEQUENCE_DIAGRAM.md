# LoL Time Analysis - Sequence Diagram

## Normal Flow (Happy Path)

```
User        FastAPI      Redis       ARQ Worker    Riot API
 │             │           │             │            │
 │ GET /stats  │           │             │            │
 ├────────────►│           │             │            │
 │             │ check     │             │            │
 │             │ cache     │             │            │
 │             ├──────────►│             │            │
 │             │ miss      │             │            │
 │             │◄──────────┤             │            │
 │             │           │             │            │
 │             │ enqueue   │             │            │
 │             │ dispatch  │             │            │
 │             ├──────────►│             │            │
 │             │           │ pickup job  │            │
 │             │           ├────────────►│            │
 │             │           │             │            │
 │             │           │             │ get PUUID  │
 │             │           │             ├───────────►│
 │             │           │             │◄───────────┤
 │             │           │             │            │
 │             │           │             │ get match  │
 │             │           │             │ IDs (879)  │
 │             │           │             ├───────────►│
 │             │           │             │◄───────────┤
 │             │           │             │            │
 │             │           │◄────────────┤ create agg │
 │             │           │  state      │ state      │
 │             │           │             │            │
 │             │           │◄────────────┤ enqueue    │
 │             │           │  879 jobs   │ 879 tasks  │
 │             │           │             │            │
 │ 202 Accepted│           │             │            │
 │◄────────────┤           │             │            │
 │             │           │             │            │
 │             │           │ ┌─────────── │ ┌────────┐ │
 │             │           │ │  Worker 1  │ │Worker N│ │
 │             │           │ │  fetch     │ │ fetch  │ │
 │             │           │ │  match_1   │ │match_N │ │
 │             │           │ ├───────────►│ ├───────►│
 │             │           │ │            │ │        │ │
 │             │           │ │◄───────────┤ │◄───────┤ │
 │             │           │ │ increment  │ │increment│ │
 │             │           │ │ counter    │ │ counter│ │
 │             │           │ │◄───────────┤ │◄───────┤ │
 │             │           │ └─────────── │ └────────┘ │
 │             │           │             │            │
 │             │           │◄────────────┤ last job   │
 │             │           │  triggers   │ triggers   │
 │             │           │  aggregator │ aggregator │
 │             │           │             │            │
 │             │           │◄────────────┤ save to    │
 │             │           │  cache &    │ cache      │
 │             │           │  cleanup    │            │
 │             │           │             │            │
 │ GET /stats  │           │             │            │
 │ (later)     │           │             │            │
 ├────────────►│           │             │            │
 │             │ check     │             │            │
 │             │ cache     │             │            │
 │             ├──────────►│             │            │
 │             │ hit!      │             │            │
 │             │◄──────────┤             │            │
 │ 200 + data  │           │             │            │
 │◄────────────┤           │             │            │
```

## Error Scenarios

### 1. Rate Limited by Riot API

```
Worker          Riot API         Redis
  │                │              │
  │ API request    │              │
  ├───────────────►│              │
  │ 429 Rate Limit │              │
  │◄───────────────┤              │
  │                │              │
  │ wait & retry   │              │
  │ (exponential   │              │
  │  backoff)      │              │
  │                │              │
```

### 2. Worker Crash (Current Issue)

```
Worker          Redis           Problem
  │               │               │
  │ processing    │               │
  │ 134/879 jobs  │               │
  │               │               │
  X CRASH         │               │
                  │               │
                  │ job state:    │ ← STUCK STATE
                  │ total: 879    │
                  │ processed:134 │
                  │               │
                  │ 745 jobs      │ ← NEVER PROCESSED
                  │ never queued  │
                  │               │
```

## Component Interactions

### Redis Usage Patterns

1. **Job Queue** (ARQ managed)

   ```
   arq:queue → [job1, job2, job3, ...]
   ```

2. **Job Coordination**

   ```
   job:player:agg → {total: 879, processed: 134, player_id: "..."}
   job:player:results → [match_data_1, match_data_2, ...]
   ```

3. **Caching**

   ```
   cache:player → [sorted_match_array]
   cooldown:player → timestamp
   ```

4. **Locking**
   ```
   lock:player → "processing"
   riot_api_rate_limit_lock → "1" (with 1.25s TTL)
   ```

## Threading Model

```
FastAPI Process (main.py)
├── Uvicorn ASGI Server
├── Multiple request handlers
└── Redis connections (sync)

ARQ Worker Process (worker.py)
├── Event loop
├── Task executor pool
├── Redis connections (async)
└── HTTP client pool (httpx)
```

## Failure Points & Recovery

| Component | Failure | Current Handling         | Ideal Handling              |
| --------- | ------- | ------------------------ | --------------------------- |
| FastAPI   | Crash   | Auto-restart via systemd | ✓ Stateless                 |
| Worker    | Crash   | Manual restart           | Auto-resume incomplete jobs |
| Redis     | Crash   | Data loss                | Persistence + backup        |
| Riot API  | 429     | Retry with backoff       | ✓ Implemented               |
| Network   | Timeout | Task failure             | Retry mechanism             |

## Performance Characteristics

- **Throughput**: ~48 API calls/minute (1.25s rate limit)
- **Latency**:
  - Cache hit: ~10ms
  - Full job: ~18+ minutes (879 matches × 1.25s)
- **Memory**: O(n) where n = number of matches
- **Storage**: ~1KB per match result in Redis
