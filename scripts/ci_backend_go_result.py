"""Fail-closed aggregate for the split Go backend CI architecture."""
import json
import os
import sys

from ci_impact import validate_plan


REQUIRED = {"impact", "storage-shard-plan", "storage-shards", "backend-go-other"}


def validate_results(needs):
    if not isinstance(needs, dict) or set(needs) != REQUIRED:
        raise ValueError("missing or unexpected backend aggregate dependencies")
    if needs["impact"].get("result") != "success":
        raise ValueError("impact did not succeed")
    plan = json.loads(needs["impact"].get("outputs", {}).get("plan", ""))
    validate_plan(plan)
    selected = plan["jobs"]["backend-go"]
    for job in ("storage-shard-plan", "storage-shards", "backend-go-other"):
        result = needs[job].get("result")
        if selected and result != "success":
            raise ValueError(f"{job}: required backend proof did not succeed")
        if not selected and result not in ("success", "skipped"):
            raise ValueError(f"{job}: unexpected backend result {result!r}")
    return selected


def main():
    try:
        selected = validate_results(json.loads(os.environ["NEEDS_JSON"]))
    except (KeyError, TypeError, ValueError, AttributeError, json.JSONDecodeError):
        print("FAIL: backend Go aggregate evidence is missing, failed, cancelled or stale", file=sys.stderr)
        return 1
    if selected:
        print("PASS: storage plan, all four storage shards, and other Go packages succeeded")
    else:
        print("PASS: backend Go was not selected by impact; skipped proofs are not test passes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
