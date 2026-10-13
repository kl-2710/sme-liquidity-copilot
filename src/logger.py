"""Ghi nhật ký kiểm toán (audit log) dạng JSON Lines."""
from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from typing import Any

from src.config import AUDIT_LOG_PATH

_LOCK = threading.Lock()


def log_event(
    session_id: str,
    firm_id: str,
    step: int,
    tool_name: str,
    tier: int | None,
    args: dict[str, Any],
    status: str,
    result_summary: str,
) -> None:
    """Ghi một bản ghi JSONL vào logs/audit.jsonl.

    Không bao giờ raise exception: lỗi ghi log chỉ được in ra stderr
    để không làm sập luồng chính của agent.

    Args:
        session_id: Mã phiên làm việc.
        firm_id: Mã doanh nghiệp (do hệ thống ép).
        step: Số thứ tự bước trong vòng lặp agent.
        tool_name: Tên công cụ được gọi.
        tier: Tầng quyền (None nếu công cụ không xác định).
        args: Tham số gọi công cụ.
        status: "ok" | "pending_approval" | "rejected" | "error".
        result_summary: Tóm tắt ngắn kết quả.
    """
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "session_id": session_id,
        "firm_id": firm_id,
        "step": step,
        "tool_name": tool_name,
        "tier": tier,
        "args": args,
        "status": status,
        "result_summary": result_summary,
    }
    try:
        AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, ensure_ascii=False, default=str)
        with _LOCK:
            with AUDIT_LOG_PATH.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as exc:  # noqa: BLE001
        print(f"[audit-log-error] {exc}")