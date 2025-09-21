# LoL Time Analysis

LoL Time Analysis is a small web application / service that fetches and analyzes League of Legends ranked match history using the Riot Games API. The project is split into a TypeScript + React frontend and a Python backend that provides an API, background workers, and Temporal workflows to coordinate long-running fetching and processing.

This README has been updated to reflect the current tech stack and how to run the project in development and with Docker.

## Highlights

- Fetch and analyze ranked match history for LoL players
- Frontend built with React + Vite + TypeScript
- Backend built with FastAPI, Temporal for workflows, and Redis for caching/coordination
- Docker Compose setup for local development

## Tech stack

Backend

- Python 3.11+
- FastAPI (API server)
- temporalio (Temporal SDK) for workflows
- Redis (cache / coordination)
- httpx (async HTTP client)
- uvicorn (ASGI server)
- python-dotenv for env config

Frontend

- React 19 + TypeScript
- Vite (dev server / build)
- TailwindCSS for styling
- Recharts for charts, Radix UI primitives, and other small UI libs

Dev tooling

- Docker / Docker Compose to run Redis, Temporal, and other infrastructure

Project layout

```
LoLTimeAnalysis/
├── backend/                 # FastAPI app, Temporal workflows, workers
├── frontend/                # React + Vite + TypeScript SPA
├── docs/                    # Architecture and diagrams
├── docker-compose.yml       # Development compose configuration
├── LICENSE
└── README.md
```

Quick start (development)

Prerequisites

- Docker & Docker Compose
- Python 3.11+
- Node 18+ / npm or pnpm

Run everything with Docker Compose (recommended)

1. Copy or create a `.env` file at the project root with your Riot API key and any other required vars (see `backend/config.py` for variable names).

2. Start core services (Redis, Temporal, etc.) and the backend in one command:

```powershell
docker compose -f .\backend\docker-compose.yml up -d --build
```

This project contains Docker Compose config under `backend/` which defines Redis and Temporal services used by the backend.

Run the backend locally (without Docker)

1. Create and activate a virtual environment:

```powershell
python -m venv .venv; .venv\Scripts\Activate
```

2. Install Python dependencies:

```powershell
pip install -r backend/requirements.txt
```

3. Start the API server:

```powershell
cd backend; uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

4. Start any worker/temporal worker processes as needed (see `backend/temporal_worker.py` and `backend/temporal_workflows.py`).

Run the frontend

1. Install Node deps and start dev server:

```powershell
cd frontend; npm install; npm run dev
```

2. Open the URL shown by Vite (usually http://localhost:5173)

Configuration

- The backend loads configuration from environment variables and `backend/config.py`. Common variables:
  - RIOT_API_KEY - Riot Games API key
  - REDIS_URL - Redis connection URL
  - TEMPORAL_ADDRESS - Temporal service address (when using Docker Compose)

API surface (examples)

- POST /api/fetch-history - start fetching a player's ranked history (body: player identifiers)
- GET /api/fetch-status?job_id=... - query the status/progress of a fetch job

Note: exact routes may be prefixed with `/api` depending on the backend server configuration. Check `backend/main.py` for the current router paths.

Development notes and tips

- The backend uses Temporal workflows to manage long-running fetches and retries. If you run Temporal via Docker Compose, start a Temporal worker locally to pick up workflows.
- Redis is used for caching and quick job state; you can inspect it with `redis-cli`.
- The frontend is TypeScript + React; change components under `frontend/src/components` and hooks under `frontend/src/hooks`.

Contribution

Contributions are welcome. Suggested flow:

1. Fork the repo
2. Create a feature branch
3. Add tests or manual verification steps
4. Open a Pull Request and describe how to run/test the change

License

This project is licensed under the MIT License. See the `LICENSE` file for details.

Acknowledgements

This project is not affiliated with or endorsed by Riot Games. Use the Riot API according to its terms of service.
