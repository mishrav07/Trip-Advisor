# Trip-Advisor

Trip-Advisor is a travel planning assistant that combines a FastAPI web app, LangGraph multi-agent orchestration, and several MCP-backed tools to generate trip recommendations, hotel options, weather guidance, and draft itineraries.

## What this project does

The app lets a user enter a travel query through the web UI and then runs a multi-agent workflow to:

- identify the destination and trip constraints
- fetch flight-related guidance through AviationStack MCP
- search hotels and travel information through Tavily MCP
- fetch current weather and forecast data through the local weather MCP server
- create a budget analysis and a draft itinerary
- pause for human approval before generating the final polished travel response

## Current architecture

This repository is currently organized around the following working pieces:

- FastAPI app in [app.py](app.py)
- UI template in [templates/index.html](templates/index.html)
- Front-end script in [static/script.js](static/script.js)
- Styles in [static/style.css](static/style.css)
- LangGraph workflow in [tools/backend.py](tools/backend.py)
- MCP client configuration in [mcp_clients.py](mcp_clients.py)
- Local weather server in [custom_weather_mcp.py](custom_weather_mcp.py)
- Python project metadata in [pyproject.toml](pyproject.toml)

## Project structure

- [app.py](app.py) — FastAPI application, routes, HTML rendering, and API endpoints
- [main.py](main.py) — minimal placeholder entry point; not the main app runtime
- [mcp_clients.py](mcp_clients.py) — MCP client setup for Tavily, AviationStack, and weather tools
- [custom_weather_mcp.py](custom_weather_mcp.py) — custom FastMCP weather server using OpenWeatherMap
- [tools/backend.py](tools/backend.py) — LangGraph state graph, supervisor, specialist agents, and final orchestration
- [tools/flight_tool.py](tools/flight_tool.py) — aviation helpers and flight parsing logic
- [tools/tavily_tool.py](tools/tavily_tool.py) — direct Tavily wrapper (kept for compatibility, though the current flow uses MCP)
- [templates/index.html](templates/index.html) — web interface for travel prompts and responses
- [static/script.js](static/script.js) — client-side interaction logic
- [static/style.css](static/style.css) — UI styles
- [pyproject.toml](pyproject.toml) — project dependencies and metadata

## Runtime flow

The request lifecycle in the current app is:

1. User submits a travel request from the UI.
2. [app.py](app.py) receives the message and calls the travel graph in [tools/backend.py](tools/backend.py).
3. A supervisor agent decides which specialist agents are needed.
4. The graph runs the selected specialists:
   - flight agent
   - hotel agent
   - weather agent
   - budget agent
   - itinerary agent
5. The draft itinerary is sent to a human review step.
6. After approval or revision, the final agent produces the response shown in the UI.

## External services used

- Groq LLM for reasoning and final text generation
- Tavily MCP for hotel and travel search results
- AviationStack MCP for flight-related tools
- OpenWeatherMap API through the local weather MCP server
- PostgreSQL database configured via DATABASE_URL for LangGraph checkpointing

## Requirements

- Python 3.11+
- A PostgreSQL database connection string in DATABASE_URL
- API keys for:
  - GROQ_API_KEY
  - TAVILY_API_KEY
  - AVIATIONSTACK_API_KEY
  - OPEN_WEATHER_API_KEY
- Optional LangSmith environment variables:
  - LANGSMITH_API_KEY
  - LANGSMITH_TRACING
  - LANGSMITH_PROJECT

## Environment variables

Create a .env file in the project root with entries similar to the following:

```env
GROQ_API_KEY=your_groq_api_key
TAVILY_API_KEY=your_tavily_api_key
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
OPEN_WEATHER_API_KEY=your_openweather_api_key
DATABASE_URL=postgresql://user:password@host:port/dbname
LANGSMITH_API_KEY=your_langsmith_key
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=trip-advisor
```

> The app expects DATABASE_URL to be set because the graph uses PostgresSaver for checkpoint persistence.

## Setup

1. Open a terminal in the project folder.
2. Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

or, if using the project metadata:

```bash
pip install -e .
```

## Run the app

Start the backend with:

```bash
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Then open:

- http://127.0.0.1:8000

## Example prompts

You can test the app with prompts such as:

- Plan a 5-day trip to Dubai from Dhaka with flights, hotels, and a sightseeing plan.
- Create a 7-day Japan itinerary from Bangladesh under 2 lakhs.
- Suggest a family-friendly vacation to Bali with weather and hotel ideas.

## API endpoints

- GET / — serves the main travel planner page
- POST /api/travel — accepts a travel request payload and returns structured results
- GET /health — returns a simple health check response

Example payload:

```json
{
  "message": "Plan a 5-day trip to Singapore from Dhaka",
  "thread_id": "optional-thread-id"
}
```

## Notes and caveats

- The current implementation uses a custom weather MCP server and a Tavily MCP endpoint, so the app depends on working MCP connectivity.
- [mcp_clients.py](mcp_clients.py) contains explicit local paths for the weather server and may need adjustment if the repository is moved to a different machine.
- The current travel graph performs a human approval checkpoint before returning the final answer.
- Live flight data may be limited by the AviationStack API and may not include exact ticket pricing.

## License

This project is provided under the repository license included in the project.


