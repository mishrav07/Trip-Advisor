from tools.tavily_tool import tavily_search

# res = tavily_search("Python programming")
# print(res)

from tools.backend import search_flights, get_database_url

res = get_database_url()
print(res)

# res = search_flights("Plan a 7 days trip Germany to France")
# print(res)


# Testing the backend functions
from tools.backend import run_travel_agent

# res = run_travel_agent(
#     user_input="Plan a 7 days trip from Germany to France, including flights, hotels, and a detailed itinerary.",
#     thread_id="test_thread_2",
# )
# print(res["answer"])
