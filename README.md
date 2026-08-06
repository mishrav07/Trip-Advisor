# Trip-Advisor

A travel planning assistant that combines FastAPI, LangGraph, Tavily, and AviationStack to generate flight recommendations, hotel search results, and practical itineraries from a single AI-driven web interface.

## Features

- FastAPI backend with a modern web UI for travel planning
- Multi-agent workflow using LangGraph and Groq LLM
- Live flight status lookup with AviationStack
- Hotel search integration via Tavily
- Itinerary generation and final travel plan formatting
- PostgreSQL checkpoint persistence for travel agent state

## Project Structure

- `app.py` — FastAPI application and web API endpoints
- `templates/index.html` — front-end travel planner UI
- `static/` — JavaScript and CSS assets for the UI
- `tools/backend.py` — LangGraph travel agent orchestration
- `tools/flight_tool.py` — aviation route parsing and live flight lookup
- `tools/tavily_tool.py` — hotel and travel info search using Tavily
- `pyproject.toml` — project metadata and Python dependencies

## Requirements

- Python 3.11 or newer
- PostgreSQL database reachable through `DATABASE_URL`
- API keys for:
  - `GROQ_API_KEY`
  - `AVIATIONSTACK_API_KEY`
  - `TAVILY_API_KEY`
  - `LANGSMITH_API_KEY` (optional, if using LangSmith tracing)
  - `LANGSMITH_TRACING` (optional)
  - `LANGSMITH_PROJECT` (optional)

## Setup

1. Clone the repository and change into the project folder.

2. Create and activate a Python environment.
   - Windows PowerShell:
     ```powershell
     python -m venv .venv
     .\.venv\Scripts\Activate.ps1
     ```
   - Windows CMD:
     ```cmd
     python -m venv .venv
     .\.venv\Scripts\activate.bat
     ```
   - macOS / Linux:
     ```bash
     python -m venv .venv
     source .venv/bin/activate
     ```

3. Install dependencies.

```bash
pip install -r requirements.txt
```

4. Create a `.env` file in the project root with the required values.

Example `.env`:

```env
GROQ_API_KEY=your_groq_api_key
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
TAVILY_API_KEY=your_tavily_api_key
DATABASE_URL=postgresql://user:password@host:port/dbname
LANGSMITH_API_KEY=your_langsmith_api_key
LANGSMITH_TRACING=your_langsmith_tracing_value
LANGSMITH_PROJECT=your_langsmith_project_name
DEFAULT_ORIGIN_DATA=BD
```

> `DEFAULT_ORIGIN_DATA` is optional and used when the user query includes a destination only.

## Run the App

Start the FastAPI server with Uvicorn:

```bash
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Then open:

- `http://127.0.0.1:8000`

## Usage

- Enter a travel request in the web UI, such as:
  - `Plan a complete 7 days Japan trip from Bangladesh under 2 lakhs.`
  - `Plan a 5 days Dubai trip from Dhaka with flights, hotels and sightseeing.`
- The app returns:
  - an AI-generated travel plan
  - live-flight information
  - hotel search results
  - an itinerary summary

## API Endpoints

- `GET /` — loads the travel planner web page
- `POST /api/travel` — accepts JSON payload:
  ```json
  {
    "message": "Plan a trip...",
    "thread_id": "optional-thread-id"
  }
  ```
- `GET /health` — health check endpoint

## Notes

- `tools/flight_tool.py` uses AviationStack to return live/status flight data, not ticket pricing.
- `tools/tavily_tool.py` uses the Tavily search API for hotel and travel recommendations.
- `tools/backend.py` orchestrates a LangGraph state graph with flight, hotel, itinerary, and final response agents.

## License

This project is provided under the terms of the repository license.


