"""Agent layer: intent router, permission tiers, tool registry and the agent entry point (`agent.py`).

A new use case is wired in here, in three places:
  * tools.py       -> add the tool function to TOOL_REGISTRY
  * permissions.py -> add its tier to TOOL_TIERS
  * router.py      -> add its keywords to INTENT_DICTIONARY (and branch on the intent in agent.py)
"""


def __getattr__(name: str):
    """Keep `from src.agent import run_agent` working without importing the OpenAI SDK at package import time."""
    if name == "run_agent":
        from src.agent.agent import run_agent
        return run_agent
    raise AttributeError(f"module 'src.agent' has no attribute {name!r}")
