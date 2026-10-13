"""Lớp phân tầng quyền và điều phối gọi công cụ."""
from __future__ import annotations

import json
from typing import Any

from src.core.logger import log_event
from src.agent.tools import TOOL_REGISTRY

TOOL_TIERS: dict[str, int] = {
    "get_working_capital": 0,
    "forecast_cash": 1,
    "match_financing": 1,
    "simulate_scenario": 1,
    "draft_action": 2,
    "submit_action": 3,
}
MAX_AUTO_TIER: int = 1


def _summarize(obj: Any, limit: int = 300) -> str:
    """Rút gọn kết quả để ghi log."""
    try:
        text = json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        text = str(obj)
    return text if len(text) <= limit else text[:limit] + "..."


def execute(
    tool_name: str,
    args: dict[str, Any],
    firm_id: str,
    session_id: str = "demo-session",
    step: int = 0,
) -> dict[str, Any]:
    """Thực thi một tool call theo tầng quyền.

    - `firm_id` luôn bị ép bằng giá trị của phiên, bỏ qua giá trị LLM đưa ra.
    - Tier 0/1: chạy tự động. Tier 2: chỉ tạo bản nháp. Tier 3/unknown: từ chối.

    Args:
        tool_name: Tên công cụ.
        args: Tham số do LLM đề xuất.
        firm_id: firm_id của phiên (nguồn tin cậy duy nhất).
        session_id: Mã phiên.
        step: Số thứ tự bước (để ghi log).

    Returns:
        Dict kết quả (luôn JSON-serializable, không raise exception).
    """
    safe_args: dict[str, Any] = dict(args) if isinstance(args, dict) else {}
    llm_firm_id = safe_args.get("firm_id")
    safe_args["firm_id"] = firm_id  # ENFORCED
    tier = TOOL_TIERS.get(tool_name)
    override_note = (
        f" [firm_id override: LLM sent '{llm_firm_id}']"
        if llm_firm_id not in (None, firm_id) else ""
    )

    def _log(status: str, summary: Any) -> None:
        log_event(session_id, firm_id, step, tool_name, tier, safe_args, status,
                  _summarize(summary) + override_note)

    # Tier 3 hoặc công cụ không xác định (cũng không có trong registry)
    if tier is None or tier > 2 or tool_name not in TOOL_REGISTRY:
        out = {"status": "rejected",
               "reason": "Tier 3 action or unknown tool cannot be executed automatically."}
        _log("rejected", out)
        return out

    try:
        if tier <= MAX_AUTO_TIER:
            result = TOOL_REGISTRY[tool_name](**safe_args)
            _log("ok", result)
            return result

        # Tier 2: chỉ tạo bản nháp, không gửi ra ngoài
        draft = TOOL_REGISTRY["draft_action"](**safe_args)
        draft_result = draft.get("result", {})
        draft_status = draft_result.get("status")
        if draft_status != "pending_approval":
            out = {
                "status": draft_status or "blocked",
                "reason": draft_result.get("reason", "Không thể tạo bản nháp an toàn.")
            }
            _log(out["status"], out)
            return out
        out = {
            "status": "pending_approval",
            "draft_id": draft_result.get("draft_id", "DRAFT-UNKNOWN"),
            "message": "Draft created, awaiting owner approval.",
            "action_type": draft_result.get("action_type"),
            "content": draft_result.get("content")
        }
        if "verified_amount_vnd" in draft_result:
            out["verified_amount_vnd"] = draft_result["verified_amount_vnd"]
            out["recipient"] = draft_result.get("recipient")
        _log("pending_approval", {**out, "draft": draft_result})
        return out
    except Exception as exc:  # noqa: BLE001
        out = {"status": "error", "reason": f"Tool failed: {exc}"}
        _log("error", out)
        return out


def submit_action_from_ui(draft_id: str, firm_id: str, approved_by: str,
                          session_id: str = "ui-session") -> dict[str, Any]:
    """Tier 3 - CHỈ dành cho UI, gọi sau khi con người bấm Duyệt.

    Hàm này KHÔNG được import vào agent.py và không có trong TOOL_SCHEMAS.
    Hiện là stub: chỉ ghi log, chưa gửi thật.
    """
    out = {"status": "submitted", "draft_id": draft_id, "approved_by": approved_by}
    log_event(session_id, firm_id, 0, "submit_action", 3, {"draft_id": draft_id,
              "approved_by": approved_by}, "ok", _summarize(out))
    return out