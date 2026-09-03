import os
import asyncio
import certifi
from dotenv import load_dotenv
from langchain_mcp_adapters.client import MultiServerMCPClient

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
AVIATION_STACK_API_KEY = os.getenv("AVIATIONSTACK_API_KEY")

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
            "args": ["aviationstack-mcp"],
            "env": AVIATION_STACK_API_KEY,
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
