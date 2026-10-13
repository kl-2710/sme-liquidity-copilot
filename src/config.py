"""Cấu hình trung tâm: API key, model mặc định, đường dẫn log, hằng số."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR: Path = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
DEFAULT_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")  # có thể đổi sang "gpt-4o" trong .env
AUDIT_LOG_PATH: Path = BASE_DIR / "logs" / "audit.jsonl"
MAX_STEPS: int = 8