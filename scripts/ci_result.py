"""Fail-closed final CI gate. Intentional omissions are NOT test passes."""
import json
import os
import re
import sys

from ci_impact import JOBS, validate_plan


def validate_results(needs, tested_sha):
    if not isinstance(needs, dict) or set(needs) != set(JOBS) | {"impact", "validate-catalog"}:
        raise ValueError("missing or unexpected job results")
    for key in ("impact", "validate-catalog"):
        if needs[key].get("result") != "success":
            raise ValueError(key + " did not succeed")
    plan = json.loads(needs["impact"].get("outputs", {}).get("plan", ""))
    validate_plan(plan)
    if (not isinstance(tested_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", tested_sha)
            or plan.get("tested_sha") != tested_sha):
        raise ValueError("tested commit does not match plan")
    for job, required in plan["jobs"].items():
        result = needs[job].get("result")
        if required and result != "success":
            raise ValueError(job + ": required proof did not succeed")
        if not required and result not in ("success", "skipped"):
            raise ValueError(job + ": unexpected failure, cancellation or missing result")
    return plan


def main():
    try:
        plan = validate_results(json.loads(os.environ["NEEDS_JSON"]), os.environ["GITHUB_SHA"])
    except (KeyError, TypeError, ValueError, AttributeError):
        print("FAIL: CI evidence is missing, failed, cancelled, unexpectedly skipped or stale", file=sys.stderr)
        return 1
    print("PASS: all selected proofs succeeded for the exact tested commit")
    for job, selected in plan["jobs"].items():
        print(f"{job}: {'required proof verified' if selected else 'not applicable by impact (not a test PASS)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
