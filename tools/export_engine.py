"""Export the real UC01/UC02 engine results into data/engine/F0x.js for the static frontend.

The engines live on branch feature/uc1-uc2-full (this branch only holds the frontend). Usage:

    git worktree add ../engine feature/uc1-uc2-full
    cd ../engine && python /path/to/this/repo/tools/export_engine.py /path/to/this/repo/data/engine

Nothing is computed here; the script only calls the engines and serialises their pydantic results.
"""
import datetime
import json
import subprocess
import sys

sys.path.insert(0, ".")
from src.core.data_loader import get_snapshot  # noqa: E402
from src.uc01_working_capital.working_capital import calculate_working_capital  # noqa: E402
from src.uc02_cash_forecast.cash_forecast import calculate_cash_forecast  # noqa: E402

LATE_DAYS = 14  # adverse case used by Task 2 / Task 4: estimated receipts shifted by 14 days (engine case_id)


def main(out_dir: str) -> None:
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    for firm in ["F01", "F02", "F03"]:
        snap = get_snapshot(firm)
        wc = calculate_working_capital(snap)
        uc01 = wc.model_dump(mode="json")
        uc01["meta"]["data_source"] = "data/uc1_workbook.xlsx"  # keep machine-specific paths out of the export
        base = calculate_cash_forecast(get_snapshot(firm), firm, uc01_result=wc).model_dump(mode="json")
        late = calculate_cash_forecast(get_snapshot(firm), firm, case_id="estimated_receipts_late", extra_days=LATE_DAYS,
                                       uc01_result=wc).model_dump(mode="json")
        payload = {
            "provenance": {"engine_branch": "feature/uc1-uc2-full", "engine_commit": commit,
                           "exported_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                           "uc01_entry": "calculate_working_capital", "uc02_entry": "calculate_cash_forecast(weeks=13)",
                           "data": "data/uc1_workbook.xlsx + data/cash_plans.csv (fictional test data)"},
            "firm": {k: snap["firm"].get(k) for k in ("firm_id", "firm_name", "industry", "supply_chain_position")},
            "uc01": uc01,
            "uc02": {"base": base, f"estimated_receipts_late_{LATE_DAYS}d": late},
        }
        js = ("/* GENERATED from the real UC01/UC02 engines by tools/export_engine.py - do not edit. Provenance inside. */\n"
              "window.LILACT_ENGINE=window.LILACT_ENGINE||{};\n"
              f"window.LILACT_ENGINE[{json.dumps(firm)}]={json.dumps(payload, ensure_ascii=False, separators=(',', ':'))};\n")
        with open(f"{out_dir}/{firm}.js", "w", encoding="utf-8") as fh:
            fh.write(js)
        print(firm, base["summary"]["min_balance_vnd"], base["summary"]["min_balance_date"], uc01["status"])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/engine")
