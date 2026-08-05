from tools.tavily_tool import tavily_search

# res = tavily_search("Python programming")
# print(res)

from tools.flight_tool import search_flights


res = search_flights("Plan a 7 days trip Germany to France")
print(res)
