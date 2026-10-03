"""Fail-closed aggregate for the sharded organization browser gate."""
import json
import os
import sys

from ci_impact import validate_plan


REQUIRED = {"impact", "organization-browser-plan", "organization-browser-shards"}


def validate_results(needs):
    if not isinstance(needs, dict) or set(needs) != REQUIRED:
        raise ValueError("missing or unexpected browser aggregate dependencies")
    if needs["impact"].get("result") != "success":
        raise ValueError("impact did not succeed")
    plan = json.loads(needs["impact"].get("outputs", {}).get("plan", ""))
    validate_plan(plan)
    selected = plan["jobs"]["organization-browser"]
    for job in ("organization-browser-plan", "organization-browser-shards"):
        result = needs[job].get("result")
        if selected and result != "success":
            raise ValueError(f"{job}: required browser proof did not succeed")
        if not selected and result not in ("success", "skipped"):
            raise ValueError(f"{job}: unexpected browser result {result!r}")
    return selected


def main() -> int:
    try:
        selected = validate_results(json.loads(os.environ["NEEDS_JSON"]))
    except (KeyError, TypeError, ValueError, AttributeError, json.JSONDecodeError):
        print("FAIL: browser aggregate evidence is missing, failed, cancelled or stale", file=sys.stderr)
        return 1
    if selected:
        print("PASS: browser shard plan and every selected shard succeeded against isolated stacks")
    else:
        print("PASS: organization browser was not selected by impact; skipped proofs are not test passes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
