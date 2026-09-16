import os
import certifi
from dotenv import load_dotenv
import asyncio

load_dotenv()

os.environ["LANGSMITH_API_KEY"] = os.getenv("LANGSMITH_API_KEY", "")
os.environ["LANGSMITH_TRACING"] = os.getenv("LANGSMITH_TRACING", "")
os.environ["LANGSMITH_PROJECT"] = os.getenv("LANGSMITH_PROJECT", "")

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

from typing import Annotated, TypedDict, Any
import operator
import uuid
import json

import psycopg
from psycopg.rows import dict_row

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.postgres import PostgresSaver

from langchain_core.messages import (
    AnyMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
)
from langchain_groq import ChatGroq

from mcp_clients import (
    tavily_mcp_search,
    aviation_mcp_call,
    extract_destination,
    forecast_mcp_search,
    weather_mcp_search,
)


# ============================================================
# DATABASE
# ============================================================


def get_database_url():
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise ValueError(
            "DATABASE_URL is missing. Please add your Render PostgreSQL "
            "External Database URL to .env"
        )

    if "sslmode=" not in database_url:
        separator = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{separator}sslmode=require"

    return database_url


# ============================================================
# API KEYS
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is missing. Please add it to your .env file.")


# ============================================================
# MODELS
# ============================================================
#
# IMPORTANT:
#
# GENERATION_MODEL:
# Used for all actual travel reasoning/generation.
#
# PROMPT_GUARD_MODEL:
# Used ONLY to detect prompt injection/jailbreak attempts.
#
# Prompt Guard 2 has a 512-token context window, so we NEVER send
# the complete LangGraph state or MCP results to it.
# ============================================================

GENERATION_MODEL = os.getenv(
    "GROQ_GENERATION_MODEL",
    "qwen/qwen3.8-27b",
)

PROMPT_GUARD_MODEL = os.getenv(
    "GROQ_PROMPT_GUARD_MODEL",
    "meta-llama/llama-prompt-guard-2-22m",
)


# Main generative model
llm = ChatGroq(
    model=GENERATION_MODEL,
    max_tokens=512,
    api_key=GROQ_API_KEY,
)


# Dedicated Prompt Guard model
prompt_guard_llm = ChatGroq(
    model=PROMPT_GUARD_MODEL,
    max_tokens=16,
    api_key=GROQ_API_KEY,
)


# ============================================================
# CONTEXT LIMITS
# ============================================================
#
# These limits protect the downstream agents from very large
# MCP/Tavily responses.
#
# They do NOT change the final response structure.
# They only prevent raw external/tool payloads from consuming
# the entire LLM context.
# ============================================================

MAX_HOTEL_CHARS = 7000
MAX_FLIGHT_CHARS = 7000
MAX_WEATHER_CHARS = 5000
MAX_BUDGET_CHARS = 7000
MAX_ITINERARY_CHARS = 12000
MAX_FINAL_SOURCE_CHARS = 9000

# Prompt Guard has a 512-token context window.
# Character limits are intentionally conservative.
PROMPT_GUARD_MAX_CHARS = 1800


# ============================================================
# STATE
# ============================================================


class TravelState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], operator.add]
    user_query: str

    # Supervisor + guardrail state
    guardrail_allowed: bool
    guardrail_reason: str
    selected_agents: list[str]
    trip_constraints: dict[str, Any]
    supervisor_reasoning: str

    # Specialist results
    flight_results: str
    hotel_results: str
    weather_results: str
    itinerary: str

    # Budget + HITL state
    budget_results: str
    approval_request: str
    approved: bool
    human_feedback: str
    final_response: str

    llm_calls: int


# ============================================================
# CONSTANTS
# ============================================================

KNOWN_AGENTS = {
    "flight_agent",
    "hotel_agent",
    "weather_agent",
    "budget_agent",
    "itinerary_agent",
}

AGENT_ORDER = [
    "flight_agent",
    "hotel_agent",
    "weather_agent",
    "budget_agent",
    "itinerary_agent",
]


# ============================================================
# HELPER FUNCTIONS
# ============================================================


def _safe_text(value: Any, max_chars: int | None = None) -> str:
    """
    Convert any tool/model result into text safely.

    If max_chars is supplied, keep the beginning and end of the
    content so important summary information is less likely to be
    lost than with a simple hard truncation.
    """

    if value is None:
        return ""

    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(
                value,
                ensure_ascii=False,
                default=str,
            )
        except Exception:
            text = str(value)

    if not max_chars or len(text) <= max_chars:
        return text

    head_size = int(max_chars * 0.75)
    tail_size = max_chars - head_size

    return (
        text[:head_size]
        + "\n\n...[content truncated for context safety]...\n\n"
        + text[-tail_size:]
    )


def _llm_text(system_prompt: str, user_prompt: str) -> str:
    """
    Generic generation-model helper.

    IMPORTANT:
    This function uses the GENERATION model, NOT Prompt Guard.
    """

    response = llm.invoke(
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
    )

    return str(response.content)


def _json_from_llm(text: str) -> dict[str, Any]:
    """Extract the first complete JSON object returned by the model."""

    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1 or end < start:
        raise ValueError("The model did not return a JSON object.")

    return json.loads(text[start : end + 1])


def _empty_constraints() -> dict[str, Any]:
    return {
        "destination": "",
        "origin": "",
        "duration": "",
        "budget": "",
        "travel_style": "",
        "special_preferences": [],
    }


# ============================================================
# PROMPT GUARD
# ============================================================


def _prompt_guard_scan(user_query: str) -> tuple[bool, str]:
    """
    Run Meta Llama Prompt Guard 2 ONLY against the user query.

    Prompt Guard 2 is a binary classifier:
        LABEL_0 = benign
        LABEL_1 = malicious

    We intentionally do not send the entire LangGraph state here.
    """

    query = _safe_text(
        user_query,
        PROMPT_GUARD_MAX_CHARS,
    ).strip()

    if not query:
        return True, "Empty query allowed."

    try:
        response = prompt_guard_llm.invoke(
            [
                HumanMessage(content=query),
            ]
        )

        raw_result = str(response.content).strip()

        print(f"[Prompt Guard] Result for query: {raw_result}")

        normalized = raw_result.upper()

        # Prompt Guard 2 is documented as a binary classifier.
        if "LABEL_1" in normalized or "MALICIOUS" in normalized:
            return False, "Prompt Guard detected a potentially malicious prompt attack."

        if "LABEL_0" in normalized or "BENIGN" in normalized:
            return True, "Prompt Guard classified the request as benign."

        # If the hosted model returns an unexpected format,
        # fail open to preserve the original application behavior.
        print(
            "[Prompt Guard] Unexpected classifier output. "
            "Falling back to semantic travel guardrail."
        )

        return True, "Prompt Guard returned an unrecognized result."

    except Exception as exc:
        print(f"[Prompt Guard] Scan failed: {exc}")

        # Fail open intentionally so a temporary guardrail problem
        # does not break the original travel-planning application.
        return True, "Prompt Guard unavailable; semantic guardrail will continue."


# ============================================================
# SUPERVISOR + GUARDRAIL AGENT
# ============================================================


def supervisor_agent(state: TravelState):
    query = state["user_query"]
    llm_calls = state.get("llm_calls", 0)

    # --------------------------------------------------------
    # STEP 1: Prompt Guard
    # --------------------------------------------------------

    prompt_guard_allowed, prompt_guard_reason = _prompt_guard_scan(query)

    if not prompt_guard_allowed:
        reason = (
            "This request was blocked because it appears to contain "
            "a prompt injection or jailbreak attempt."
        )

        return {
            "guardrail_allowed": False,
            "guardrail_reason": reason,
            "selected_agents": [],
            "trip_constraints": _empty_constraints(),
            "supervisor_reasoning": reason,
            "final_response": reason,
            "messages": [AIMessage(content=f"Prompt Guard blocked request: {reason}")],
            "llm_calls": llm_calls,
        }

    # --------------------------------------------------------
    # STEP 2: Existing semantic travel guardrail
    #
    # This preserves your original behavior:
    # unrelated requests are still rejected.
    # --------------------------------------------------------

    guardrail_prompt = f"""
Determine whether the following request belongs to travel planning or travel
information.

Valid requests can include:
- destinations
- flights
- hotels
- weather
- budgets
- visas
- transportation
- sightseeing
- food
- packing
- itineraries

Block clearly unrelated requests and requests asking for harmful or illegal
instructions.

Do not block a valid travel request merely because some details are missing.

Return strict JSON only:
{{
  "allowed": true,
  "reason": ""
}}

User request:
{query}
"""

    try:
        guardrail_raw = _llm_text(
            "You are the semantic input guardrail for a travel-planning "
            "application. Return strict JSON only.",
            guardrail_prompt,
        )

        guardrail_result = _json_from_llm(guardrail_raw)

        allowed = bool(guardrail_result.get("allowed", True))

        semantic_reason = str(guardrail_result.get("reason", "")).strip()

        llm_calls += 1

    except Exception as exc:
        print(f"Semantic guardrail fallback used: {exc}")

        allowed = True

        semantic_reason = "Semantic guardrail validation fallback allowed the request."

    if not allowed:
        reason = semantic_reason or (
            "TripMate AI can only help with travel-planning requests. "
            "Please ask about a destination, flight, hotel, weather, "
            "budget, or itinerary."
        )

        return {
            "guardrail_allowed": False,
            "guardrail_reason": reason,
            "selected_agents": [],
            "trip_constraints": _empty_constraints(),
            "supervisor_reasoning": reason,
            "final_response": reason,
            "messages": [AIMessage(content=f"Guardrail blocked request: {reason}")],
            "llm_calls": llm_calls,
        }

    # --------------------------------------------------------
    # STEP 3: Supervisor
    # --------------------------------------------------------

    supervisor_prompt = f"""
You are the supervisor of a multi-agent travel-planning system.

Choose only the specialist agents needed for the request.

Available agents:

- flight_agent:
  flights, airports, airlines, routes, airfare, booking advice

- hotel_agent:
  hotels, accommodation, neighborhoods, places to stay

- weather_agent:
  weather, climate, season, forecast, packing advice

- budget_agent:
  cost, affordability, price limits, budget feasibility

- itinerary_agent:
  creates the integrated travel plan and must always be included

Return strict JSON only using this schema:

{{
  "selected_agents": [
    "flight_agent",
    "hotel_agent",
    "weather_agent",
    "budget_agent",
    "itinerary_agent"
  ],
  "trip_constraints": {{
    "destination": "",
    "origin": "",
    "duration": "",
    "budget": "",
    "travel_style": "",
    "special_preferences": []
  }},
  "reasoning": ""
}}

User request:
{query}
"""

    try:
        supervisor_raw = _llm_text(
            "You route work to travel specialist agents. Return strict JSON only.",
            supervisor_prompt,
        )

        parsed = _json_from_llm(supervisor_raw)

        requested_agents = parsed.get(
            "selected_agents",
            [],
        )

        selected_agents = [
            name
            for name in AGENT_ORDER
            if name in requested_agents and name in KNOWN_AGENTS
        ]

        # The itinerary agent is always required.
        if "itinerary_agent" not in selected_agents:
            selected_agents.append("itinerary_agent")

        constraints = _empty_constraints()

        parsed_constraints = parsed.get(
            "trip_constraints",
            {},
        )

        if isinstance(parsed_constraints, dict):
            constraints.update(parsed_constraints)

        reasoning = str(parsed.get("reasoning", "")).strip()

        llm_calls += 1

    except Exception as exc:
        print(f"Supervisor fallback used: {exc}")

        # Preserve original full workflow behavior.
        selected_agents = AGENT_ORDER.copy()

        constraints = _empty_constraints()

        reasoning = (
            "Supervisor parsing failed, so the original full "
            "travel workflow was selected as a safe fallback."
        )

    return {
        "guardrail_allowed": True,
        "guardrail_reason": (f"{prompt_guard_reason} {semantic_reason}").strip(),
        "selected_agents": selected_agents,
        "trip_constraints": constraints,
        "supervisor_reasoning": reasoning,
        "messages": [AIMessage(content="Supervisor created the agent plan.")],
        "llm_calls": llm_calls,
    }


# ============================================================
# GUARDRAIL BLOCKED RESPONSE
# ============================================================


def guardrail_blocked_agent(state: TravelState):
    reason = (
        state.get("final_response")
        or state.get("guardrail_reason")
        or "This request was blocked by the travel input guardrail."
    )

    return {
        "final_response": reason,
        "messages": [AIMessage(content=reason)],
    }


# ============================================================
# FLIGHT AGENT
# ============================================================

FLIGHT_AGENT_PROMPT = """
You are a travel flight expert.

User Query:
{query}

Airport Information:
{airport_data}

Airline Information:
{airline_data}

Generate:

1. Likely departure airport
2. Likely arrival airport
3. Airlines serving this route
4. Typical flight duration
5. Estimated airfare range
6. Peak season pricing warning
7. Booking advice

Return concise travel guidance.
"""


def flight_agent(state: TravelState):
    print("\nINSIDE FLIGHT AGENT\n")

    query = state["user_query"]

    try:
        airports = asyncio.run(aviation_mcp_call("list_airports"))

        airlines = asyncio.run(aviation_mcp_call("list_airlines"))

        print("\nAIRPORTS:", airports)
        print("\nAIRLINES:", airlines)

        prompt = FLIGHT_AGENT_PROMPT.format(
            query=query,
            airport_data=_safe_text(
                airports,
                3000,
            ),
            airline_data=_safe_text(
                airlines,
                3000,
            ),
        )

        response = llm.invoke(
            [
                SystemMessage(content="You are an expert travel flight planner."),
                HumanMessage(content=prompt),
            ]
        )

        flight_data = str(response.content)

    except Exception as e:
        flight_data = f"Flight information unavailable: {str(e)}"

    flight_data = _safe_text(
        flight_data,
        MAX_FLIGHT_CHARS,
    )

    return {
        "flight_results": flight_data,
        "messages": [AIMessage(content="Flight recommendations generated")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# ============================================================
# HOTEL AGENT
# ============================================================


def hotel_agent(state: TravelState):
    query = f"Best hotels for {state['user_query']}"

    try:
        hotel_results = asyncio.run(tavily_mcp_search(query))

        hotel_results = _safe_text(
            hotel_results,
            MAX_HOTEL_CHARS,
        )

    except Exception as exc:
        hotel_results = f"Hotel information unavailable: {str(exc)}"

    return {
        "hotel_results": hotel_results,
        "messages": [AIMessage(content="Hotel information fetched.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# ============================================================
# WEATHER AGENT
# ============================================================


def weather_agent(state: TravelState):
    city = extract_destination(state["user_query"])

    try:
        weather_data = asyncio.run(weather_mcp_search(city))

        forecast_data = asyncio.run(forecast_mcp_search(city))

        weather_result = f"""
Current Weather:
{_safe_text(weather_data, 2200)}

Forecast:
{_safe_text(forecast_data, 2200)}
"""

        weather_result = _safe_text(
            weather_result,
            MAX_WEATHER_CHARS,
        )

    except Exception as exc:
        weather_result = f"Weather information unavailable: {str(exc)}"

    return {
        "weather_results": weather_result,
        "messages": [AIMessage(content="Weather information fetched.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# ============================================================
# BUDGET AGENT
# ============================================================


def budget_agent(state: TravelState):

    flight_results = _safe_text(
        state.get("flight_results", ""),
        MAX_FLIGHT_CHARS,
    )

    hotel_results = _safe_text(
        state.get("hotel_results", ""),
        MAX_HOTEL_CHARS,
    )

    weather_results = _safe_text(
        state.get("weather_results", ""),
        MAX_WEATHER_CHARS,
    )

    constraints = _safe_text(
        state.get("trip_constraints", {}),
        2500,
    )

    prompt = f"""
Analyze whether this trip is realistic for the user's budget.

User Query:
{state["user_query"]}

Trip Constraints:
{constraints}

Flight Results:
{flight_results}

Hotel Results:
{hotel_results}

Weather Results:
{weather_results}

Return:

1. Estimated cost categories
2. Budget risk areas
3. Money-saving suggestions
4. Overall feasibility

If exact live prices are unavailable, clearly label estimates as approximate.

Do not invent exact live prices.
"""

    try:
        response = llm.invoke(
            [
                SystemMessage(content="You are a practical travel budget analyst."),
                HumanMessage(content=prompt),
            ]
        )

        budget_data = str(response.content)

    except Exception as exc:
        budget_data = f"Budget analysis unavailable: {str(exc)}"

    budget_data = _safe_text(
        budget_data,
        MAX_BUDGET_CHARS,
    )

    return {
        "budget_results": budget_data,
        "messages": [AIMessage(content="Budget assessment generated.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# ============================================================
# ITINERARY AGENT
# ============================================================


def itinerary_agent(state: TravelState):

    flight_results = _safe_text(
        state.get("flight_results", ""),
        MAX_FLIGHT_CHARS,
    )

    hotel_results = _safe_text(
        state.get("hotel_results", ""),
        MAX_HOTEL_CHARS,
    )

    weather_results = _safe_text(
        state.get("weather_results", ""),
        MAX_WEATHER_CHARS,
    )

    budget_results = _safe_text(
        state.get("budget_results", ""),
        MAX_BUDGET_CHARS,
    )

    prompt = f"""
Create a complete travel itinerary.

User Query:
{state["user_query"]}

Trip Constraints:
{_safe_text(state.get("trip_constraints", {}), 2500)}

Flight Results:
{flight_results}

Hotel Results:
{hotel_results}

Weather Results:
{weather_results}

Budget Results:
{budget_results}

Make the itinerary practical, budget-aware, and easy to follow.

Create a clear draft that is ready for human review.
"""

    try:
        response = llm.invoke(
            [
                SystemMessage(content="You are an expert travel planner."),
                HumanMessage(content=prompt),
            ]
        )

        itinerary_data = str(response.content)

    except Exception as exc:
        itinerary_data = f"Itinerary generation unavailable: {str(exc)}"

    itinerary_data = _safe_text(
        itinerary_data,
        MAX_ITINERARY_CHARS,
    )

    approval_request = (
        "Please review the generated draft itinerary. "
        "Approve it to create the final polished plan, "
        "or provide feedback for revision."
    )

    return {
        "itinerary": itinerary_data,
        "approval_request": approval_request,
        "messages": [AIMessage(content="Draft itinerary created for human review.")],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# ============================================================
# HUMAN-IN-THE-LOOP APPROVAL
# ============================================================


def human_approval_agent(state: TravelState):

    review = interrupt(
        {
            "question": "Do you approve this itinerary?",
            "draft_itinerary": state.get(
                "itinerary",
                "",
            ),
            "approval_request": state.get(
                "approval_request",
                "",
            ),
            "selected_agents": state.get(
                "selected_agents",
                [],
            ),
            "supervisor_reasoning": state.get(
                "supervisor_reasoning",
                "",
            ),
            "expected_response": {
                "approved": True,
                "feedback": "Optional revision feedback",
            },
        }
    )

    approved = bool(review.get("approved", False))

    human_feedback = str(review.get("feedback", "")).strip()

    return {
        "approved": approved,
        "human_feedback": human_feedback,
        "messages": [AIMessage(content="Human approval step completed.")],
    }


# ============================================================
# FINAL RESPONSE AGENT
# ============================================================


def final_agent(state: TravelState):

    if state.get("approved", False):
        review_instruction = (
            "The user approved the draft. Preserve its decisions while polishing it."
        )

    else:
        review_instruction = f"""
The user requested a revision.

Apply this feedback carefully:
{state.get("human_feedback", "") or "Improve the draft before finalizing it."}
"""

    # Keep source material bounded.
    flight_results = _safe_text(
        state.get("flight_results", ""),
        MAX_FLIGHT_CHARS,
    )

    hotel_results = _safe_text(
        state.get("hotel_results", ""),
        MAX_HOTEL_CHARS,
    )

    weather_results = _safe_text(
        state.get("weather_results", ""),
        MAX_WEATHER_CHARS,
    )

    budget_results = _safe_text(
        state.get("budget_results", ""),
        MAX_BUDGET_CHARS,
    )

    itinerary = _safe_text(
        state.get("itinerary", ""),
        MAX_ITINERARY_CHARS,
    )

    final_prompt = f"""
Generate the final travel response for the user.

Human Review:
{review_instruction}

User Request:
{state["user_query"]}

Supervisor Constraints:
{_safe_text(state.get("trip_constraints", {}), 2500)}

Flights:
{flight_results}

Hotels:
{hotel_results}

Weather:
{weather_results}

Budget Analysis:
{budget_results}

Draft Itinerary:
{itinerary}

Format the final answer beautifully using these sections:

1. Trip Summary
2. Flight Information
3. Hotel Suggestions
4. Weather Information
5. Day-by-Day Itinerary
6. Estimated Budget
7. Final Recommendations

Important:

- Be clear and practical.
- Mention that live flight APIs may not provide ticket prices
  when pricing is unavailable.
- Include weather-based travel advice.
- Keep the response useful for real travel planning.
- Incorporate the human feedback when revision was requested.
- Do not invent live prices when they are unavailable.
"""

    try:
        response = llm.invoke(
            [
                SystemMessage(
                    content=("You are a professional AI travel booking assistant.")
                ),
                HumanMessage(content=final_prompt),
            ]
        )

        final_response = str(response.content)

    except Exception as exc:
        final_response = f"Unable to generate the final travel response: {str(exc)}"

    return {
        "final_response": final_response,
        "messages": [AIMessage(content=final_response)],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


# ============================================================
# DYNAMIC SUPERVISOR ROUTING
# ============================================================

ROUTE_MAP = {
    "guardrail_blocked": "guardrail_blocked",
    "flight_agent": "flight_agent",
    "hotel_agent": "hotel_agent",
    "weather_agent": "weather_agent",
    "budget_agent": "budget_agent",
    "itinerary_agent": "itinerary_agent",
}


def _selected_agents(
    state: TravelState,
) -> list[str]:

    selected = state.get(
        "selected_agents",
        [],
    )

    return [agent for agent in AGENT_ORDER if agent in selected]


def route_from_supervisor(
    state: TravelState,
) -> str:

    if not state.get(
        "guardrail_allowed",
        True,
    ):
        return "guardrail_blocked"

    selected = _selected_agents(state)

    return selected[0] if selected else "itinerary_agent"


def route_after_agent(
    current_agent: str,
):

    def route(state: TravelState) -> str:

        selected = _selected_agents(state)

        current_index = AGENT_ORDER.index(current_agent)

        for next_agent in AGENT_ORDER[current_index + 1 :]:
            if next_agent in selected:
                return next_agent

        return "itinerary_agent"

    return route


# ============================================================
# BUILD GRAPH
# ============================================================

graph = StateGraph(TravelState)

graph.add_node(
    "supervisor",
    supervisor_agent,
)

graph.add_node(
    "guardrail_blocked",
    guardrail_blocked_agent,
)

graph.add_node(
    "flight_agent",
    flight_agent,
)

graph.add_node(
    "hotel_agent",
    hotel_agent,
)

graph.add_node(
    "weather_agent",
    weather_agent,
)

graph.add_node(
    "budget_agent",
    budget_agent,
)

graph.add_node(
    "itinerary_agent",
    itinerary_agent,
)

graph.add_node(
    "human_approval",
    human_approval_agent,
)

graph.add_node(
    "final_agent",
    final_agent,
)


graph.add_edge(
    START,
    "supervisor",
)

graph.add_conditional_edges(
    "supervisor",
    route_from_supervisor,
    ROUTE_MAP,
)


graph.add_conditional_edges(
    "flight_agent",
    route_after_agent("flight_agent"),
    ROUTE_MAP,
)

graph.add_conditional_edges(
    "hotel_agent",
    route_after_agent("hotel_agent"),
    ROUTE_MAP,
)

graph.add_conditional_edges(
    "weather_agent",
    route_after_agent("weather_agent"),
    ROUTE_MAP,
)

graph.add_conditional_edges(
    "budget_agent",
    route_after_agent("budget_agent"),
    ROUTE_MAP,
)


graph.add_edge(
    "itinerary_agent",
    "human_approval",
)

graph.add_edge(
    "human_approval",
    "final_agent",
)

graph.add_edge(
    "final_agent",
    END,
)

graph.add_edge(
    "guardrail_blocked",
    END,
)


# ============================================================
# POSTGRES CHECKPOINTER
# ============================================================

DATABASE_URL = get_database_url()

_conn = psycopg.connect(
    DATABASE_URL,
    autocommit=True,
    row_factory=dict_row,
)

checkpointer = PostgresSaver(_conn)

checkpointer.setup()

travel_graph = graph.compile(checkpointer=checkpointer)


# ============================================================
# FASTAPI-FACING FUNCTIONS
# ============================================================


def _interrupt_payload(
    result: dict[str, Any],
) -> dict[str, Any] | None:

    interrupts = result.get(
        "__interrupt__",
        [],
    )

    if not interrupts:
        return None

    first_interrupt = interrupts[0]

    payload = getattr(
        first_interrupt,
        "value",
        first_interrupt,
    )

    return payload if isinstance(payload, dict) else {"value": payload}


def _serialize_result(
    result: dict[str, Any],
    thread_id: str,
) -> dict[str, Any]:

    messages = result.get(
        "messages",
        [],
    )

    last_message = messages[-1].content if messages else ""

    answer = result.get("final_response") or last_message

    interrupt_payload = _interrupt_payload(result)

    if interrupt_payload:
        answer = interrupt_payload.get("draft_itinerary") or result.get(
            "itinerary",
            "",
        )

    return {
        "thread_id": thread_id,
        "answer": answer,
        "requires_approval": (interrupt_payload is not None),
        "approval_request": (
            interrupt_payload.get(
                "approval_request",
                "",
            )
            if interrupt_payload
            else result.get(
                "approval_request",
                "",
            )
        ),
        "flight_results": result.get(
            "flight_results",
            "",
        ),
        "hotel_results": result.get(
            "hotel_results",
            "",
        ),
        "weather_results": result.get(
            "weather_results",
            "",
        ),
        "budget_results": result.get(
            "budget_results",
            "",
        ),
        "itinerary": (
            interrupt_payload.get(
                "draft_itinerary",
                "",
            )
            if interrupt_payload
            else result.get(
                "itinerary",
                "",
            )
        ),
        "selected_agents": result.get(
            "selected_agents",
            [],
        ),
        "trip_constraints": result.get(
            "trip_constraints",
            {},
        ),
        "supervisor_reasoning": result.get(
            "supervisor_reasoning",
            "",
        ),
        "guardrail_allowed": result.get(
            "guardrail_allowed",
            True,
        ),
        "guardrail_reason": result.get(
            "guardrail_reason",
            "",
        ),
        "approved": result.get("approved"),
        "human_feedback": result.get(
            "human_feedback",
            "",
        ),
        "llm_calls": result.get(
            "llm_calls",
            0,
        ),
    }


# ============================================================
# START TRAVEL AGENT
# ============================================================


def run_travel_agent(
    user_input: str,
    thread_id: str | None = None,
):
    """
    Start a new travel-planning run and pause at
    human approval.
    """

    if not thread_id:
        thread_id = f"user_{uuid.uuid4().hex}"

    config = {"configurable": {"thread_id": thread_id}}

    result = travel_graph.invoke(
        {
            "messages": [HumanMessage(content=user_input)],
            "user_query": user_input,
            "guardrail_allowed": True,
            "guardrail_reason": "",
            "selected_agents": [],
            "trip_constraints": (_empty_constraints()),
            "supervisor_reasoning": "",
            "flight_results": "",
            "hotel_results": "",
            "weather_results": "",
            "budget_results": "",
            "itinerary": "",
            "approval_request": "",
            "approved": False,
            "human_feedback": "",
            "final_response": "",
            "llm_calls": 0,
        },
        config=config,
    )

    return _serialize_result(
        result,
        thread_id,
    )


# ============================================================
# RESUME TRAVEL AGENT
# ============================================================


def resume_travel_agent(
    thread_id: str,
    approved: bool,
    feedback: str = "",
):
    """
    Resume the paused LangGraph thread after human review.
    """

    if not thread_id:
        raise ValueError("thread_id is required to resume a travel plan.")

    config = {"configurable": {"thread_id": thread_id}}

    result = travel_graph.invoke(
        Command(
            resume={
                "approved": approved,
                "feedback": feedback.strip(),
            }
        ),
        config=config,
    )

    return _serialize_result(
        result,
        thread_id,
    )
