"""pytest configuration: make the project root importable so `from src...` works from any working directory."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest  # noqa: E402


def pytest_configure(config):
    """Runs before collection: some test files execute checks when they are imported, so the log must already point to a temp file."""
    import pathlib
    import tempfile

    import src.core.logger as logger
    logger.AUDIT_LOG_PATH = pathlib.Path(tempfile.mkdtemp(prefix="audit-")) / "audit.jsonl"


@pytest.fixture(autouse=True)
def _isolated_runtime(monkeypatch, tmp_path):
    """Every test runs without side effects on your real data:
    - nothing is written to logs/audit.jsonl (that file holds the real runs of `python tests/agent/test_agent.py`);
    - the real OpenAI key in .env is never used, so no test calls the model (tests that need a model patch it themselves)."""
    import src.agent.agent as agent
    log = tmp_path / "audit.jsonl"
    monkeypatch.setattr("src.core.logger.AUDIT_LOG_PATH", log)
    monkeypatch.setattr(agent, "AUDIT_LOG_PATH", log)
    monkeypatch.setattr(agent, "OPENAI_API_KEY", "")
    monkeypatch.setattr(agent, "_client", None)