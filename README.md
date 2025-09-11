# LoL Time Analysis

A web application to fetch and analyze League of Legends ranked match history using the Riot Games API.

## Features

- 🎮 Fetch ranked match history for any LoL player
- 📊 Real-time progress tracking with live updates
- 🌙 Automatic light/dark mode based on system preference
- ⚡ Redis caching for fast data retrieval
- 🔄 Background job processing with rate limiting
- 📱 Responsive web interface

## Tech Stack

### Backend
- **FastAPI** - Modern, fast web framework for APIs
- **Redis** - In-memory data store for caching and job queuing
- **ARQ** - Async job queue for background tasks
- **httpx** - Async HTTP client for Riot API calls

### Frontend
- **Vanilla JavaScript** - No frameworks, pure JS
- **HTML5 & CSS3** - Modern web standards
- **Responsive Design** - Works on all devices

## Project Structure

```
LoLTimeAnalysis/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── worker.py            # Background job worker
│   ├── redis_service.py     # Redis operations
│   ├── riot_api_client.py   # Riot API integration
│   ├── config.py            # Configuration settings
│   └── requirements.txt     # Python dependencies
├── frontend/
│   └── index.html          # Web interface
├── docker-compose.yml      # Docker services
└── README.md
```

## Quick Start

### Prerequisites
- Python 3.11+
- Redis server
- Riot Games API key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Furkan-rgb/loltimeanalysis.git
   cd loltimeanalysis
   ```

2. **Set up Python environment**
   ```bash
   python -m venv .venv
   .venv\Scripts\activate  # Windows
   # or
   source .venv/bin/activate  # Linux/Mac
   ```

3. **Install dependencies**
   ```bash
   pip install -r backend/requirements.txt
   ```

4. **Configure environment**
   - Get your API key from [Riot Developer Portal](https://developer.riotgames.com/)
   - Update `backend/config.py` with your API key

5. **Start Redis** (using Docker)
   ```bash
   docker-compose up redis -d
   ```

6. **Run the application**
   
   Terminal 1 - Start the API server:
   ```bash
   cd backend
   python main.py
   ```
   
   Terminal 2 - Start the worker:
   ```bash
   cd backend
   python worker.py
   ```

7. **Open the web interface**
   - Open `frontend/index.html` in your browser
   - Or serve it with a local web server

## Usage

1. Enter a League of Legends **Game Name** and **Tag Line** (e.g., "Faker" + "KR1")
2. Click **"Fetch History"** to get recent ranked matches
3. View real-time progress as data is fetched from Riot API
4. Analyze match history in the results table
5. Click **"Update"** to refresh data (respects rate limits)

## API Endpoints

- `POST /fetch-history/` - Start fetching match history
- `GET /fetch-status/` - Check fetch job status

## Configuration

Key settings in `backend/config.py`:
- `RIOT_API_KEY` - Your Riot Games API key
- `GAMES_TO_FETCH` - Number of recent games to fetch
- `CACHE_EXPIRATION_SECONDS` - How long to cache results
- `COOLDOWN_SECONDS` - Rate limiting between requests

## Development

### Running with auto-reload

```bash
# API server with auto-reload
cd backend
python main.py

# Worker with file watching
cd backend
python worker.py --watch
```

### Docker Development

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This project isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
