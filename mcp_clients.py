import os
import asyncio
import certifi
from dotenv import load_dotenv
from pathlib import Path
from langchain_mcp_adapters.client import MultiServerMCPClient

from langchain_groq import ChatGroq


os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
AVIATION_STACK_API_KEY = os.getenv("AVIATIONSTACK_API_KEY")
OPEN_WEATHER_API_KEY = os.getenv("OPEN_WEATHER_API_KEY")

PROJECT_DIR = Path(__file__).resolve().parent
WEATHER_SERVER_PATH = PROJECT_DIR / "custom_weather_mcp.py"


WEATHER_SERVER_PATH = "D:\Data Science\Generative AI\Self Learning - AI Projects\Trip-Advisor\custom_weather_mcp.py"
# WEATHER_SERVER_PATH = BASE_DIR / "custom_weather_mcp_server.py"

# LLM
llm = ChatGroq(
    model="qwen/qwen3.6-27b", max_tokens=900, api_key=os.getenv("GROQ_API_KEY")
)


# Creating the client

client = MultiServerMCPClient(
    {
        "tavily": {
            "transport": "streamable_http",
            "url": f"https://mcp.tavily.com/mcp/?tavilyApiKey={TAVILY_API_KEY}",
        },
        "aviationstack": {
            "transport": "stdio",
            "command": "uvx",
            "args": ["--with", "mcp<2", "aviationstack-mcp"],
            "env": {"AVIATION_STACK_API_KEY": AVIATION_STACK_API_KEY},
        },
        "weather": {
            "transport": "stdio",
            "command": r"D:\Data Science\Generative AI\Self Learning - AI Projects\Trip-Advisor\.venv\Scripts\python.exe",  # Add your own python environment path here. This is the path to the python.exe file in your conda environment.
            "args": [
                r"D:\Data Science\Generative AI\Self Learning - AI Projects\Trip-Advisor\custom_weather_mcp.py"
            ],  # Add the location where you have saved the custom_weather_mcp.py file. This is the path to the custom_weather_mcp.py file in your project directory.
            "env": {"OPEN_WEATHER_API_KEY": OPEN_WEATHER_API_KEY},
        },
    }
)

# ==========================================
# Diagnostic function
# ==========================================


async def get_all_tools():
    """
    Load each MCP server separately.

    A broken server will no longer prevent the other
    working servers from loading.
    """

    all_tools = []

    for server_name in ("tavily", "aviationstack", "weather"):
        try:
            tools = await client.get_tools(server_name=server_name)

            all_tools.extend(tools)

            print(f"\nAvailable tools from {server_name} MCP:\n")

            for tool in tools:
                print(tool.name)

        except Exception as error:
            print(f"\nCould not connect to {server_name} MCP:\n{error}\n")

    return all_tools


# ==========================================
# Tavily MCP tool
# ==========================================

search_tool = None


async def initialize_mcp():
    """
    Initialize only Tavily.

    Previously this function initialized all MCP servers,
    so an AviationStack or Weather failure also caused
    Tavily hotel search to fail.
    """

    global search_tool

    if search_tool is not None:
        return

    tools = await client.get_tools(server_name="tavily")

    tools_by_name = {tool.name: tool for tool in tools}

    search_tool = tools_by_name.get("tavily_search")

    if search_tool is None:
        available_tools = ", ".join(tools_by_name.keys())

        raise RuntimeError(
            "Tavily MCP connected, but the "
            "'tavily_search' tool was not found. "
            f"Available tools: "
            f"{available_tools or 'none'}"
        )


async def tavily_mcp_search(query: str):
    await initialize_mcp()

    result = await search_tool.ainvoke({"query": query})

    return result


# ==========================================
# AviationStack MCP tools
# ==========================================

aviation_tools = {}


async def initialize_aviation_tools():
    global aviation_tools

    if aviation_tools:
        return

    # Load only AviationStack.
    # Tavily and Weather will not be initialized here.
    tools = await client.get_tools(server_name="aviationstack")

    aviation_tools = {tool.name: tool for tool in tools}

    if not aviation_tools:
        raise RuntimeError("AviationStack MCP connected but returned no tools.")


async def aviation_mcp_call(tool_name: str, tool_args: dict = None):
    await initialize_aviation_tools()

    tool = aviation_tools.get(tool_name)

    if tool is None:
        available_tools = ", ".join(sorted(aviation_tools.keys()))

        raise ValueError(
            f"AviationStack tool '{tool_name}' "
            "was not found. "
            f"Available tools: "
            f"{available_tools or 'none'}"
        )

    result = await tool.ainvoke(tool_args or {})

    return result


# ==========================================
# Weather MCP tools
# ==========================================

weather_tool = None
forecast_tool = None


async def initialize_weather_tools():
    global weather_tool
    global forecast_tool

    if weather_tool is not None:
        return

    # if not Path(WEATHER_SERVER_PATH).exists():
    #     raise FileNotFoundError(
    #         f"Weather MCP server file was not found: {WEATHER_SERVER_PATH}"
    #     )

    # Load only Weather.
    # Tavily and AviationStack will not be started.
    # tools = await client.get_tools(server_name="weather")

    # tools_by_name = {tool.name: tool for tool in tools}

    # weather_tool = tools_by_name.get("get_current_weather")

    # forecast_tool = tools_by_name.get("get_forecast")

    # missing_tools = []

    # if weather_tool is None:
    #     missing_tools.append("get_current_weather")

    # if forecast_tool is None:
    #     missing_tools.append("get_forecast")

    # if missing_tools:
    #     available_tools = ", ".join(tools_by_name.keys())

    #     raise RuntimeError(
    #         "Missing Weather MCP tools: "
    #         f"{', '.join(missing_tools)}. "
    #         f"Available tools: "
    #         f"{available_tools or 'none'}"
    #     )

    tools = await client.get_tools()
    weather_tool = next(tool for tool in tools if tool.name == "get_current_weather")
    forecast_tool = next(tool for tool in tools if tool.name == "get_forecast")


async def weather_mcp_search(city: str):
    await initialize_weather_tools()

    result = await weather_tool.ainvoke({"city": city})

    return result


async def forecast_mcp_search(city: str):
    await initialize_weather_tools()

    result = await forecast_tool.ainvoke({"city": city})

    return result


# ==========================================
# Destination extractor : To extract the destination city or country from the user query using LLM
# ==========================================


def extract_destination(query: str):
    prompt = f"""
    Extract only the destination city or country.

    Query:
    {query}

    Return only destination name.
    """

    response = llm.invoke(prompt)

    return response.content.strip()
