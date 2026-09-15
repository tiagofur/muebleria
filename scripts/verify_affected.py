"""Run the conservative local plan once. Logs stay on disk, failures stay fatal.

Not a dispatcher, lease, approval, host proof or CI substitute. This runs locally
and synchronously; external orchestration and its authorized budgets stay intact.
"""
import argparse
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from ci_impact import ROOT, local_plan, validate_plan


def commands(plan):
    validate_plan(plan)
    tasks = [("contracts", ["python3", "scripts/check_openapi_drift.py"], ROOT),
             ("ci-tests", ["python3", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_ci_*.py"], ROOT),
             ("factory-tests", ["python3", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_factory_efficiency.py"], ROOT),
             ("factory-contract", ["python3", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_factory_workflow_contract.py"], ROOT)]
    selected = plan["jobs"]
    if selected["typescript"]:
        tasks += [("typecheck", ["pnpm", "typecheck"], ROOT), ("typescript", ["pnpm", "test"], ROOT)]
    if selected["backend-go"]:
        tasks += [("backend-go", ["go", "test", "-p", "1", "-timeout=30m", "-v", "./..."], ROOT / "backend-go")]
    if selected["sketchup-extension"]:
        tasks += [("sketchup-local-os", ["bundle", "exec", "rake", "verify"], ROOT / "apps/sketchup-extension")]
    if selected["proyectar-visual"]:
        tasks += [("visual", ["pnpm", "exec", "playwright", "test", "--config=playwright.config.ts", "tests/visual/proyectar-webgl.spec.ts"], ROOT)]
    if selected["foundation-postgres"]:
        tasks += [("foundation-postgres", ["bash", "scripts/foundation-gate-a.sh", "--stage", "postgres"], ROOT)]
    if selected["organization-browser"]:
        tasks += [("browser", ["bash", "scripts/foundation-gate-a.sh", "--stage", "browser"], ROOT)]
    return tasks



def run_bounded(command, cwd, stream, remaining):
    """POSIX process-group cleanup; never leave a timed-out test intentionally alive."""
    if os.name != "posix":
        raise OSError("bounded local runner requires POSIX; use CI on Windows")
    process = subprocess.Popen(command, cwd=cwd, stdout=stream,
                               stderr=subprocess.STDOUT, start_new_session=True)
    try:
        return process.wait(timeout=remaining)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        # Also clean group children after their direct parent has exited.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        return 124


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", help="explicit target ref, e.g. origin/main; missing selects full")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--plan", action="store_true", help="print plan without executing commands")
    parser.add_argument("--budget-seconds", type=int, default=3600, help="remaining approved active budget, shared across commands")
    args = parser.parse_args()
    if not 0 < args.budget_seconds <= 3600:
        parser.error("remaining budget must be between 1 and 3600 seconds")
    deadline = time.monotonic() + args.budget_seconds
    plan = local_plan(ROOT, args.base, force_full=args.full)
    print(json.dumps(plan, indent=2), flush=True)
    tasks = commands(plan)
    if args.plan:
        for name, command, _ in tasks:
            print(name + ": " + " ".join(command))
        return 0
    # Never return a green Go run with storage tests skipped for absent DB.
    if plan["jobs"]["backend-go"] and not os.environ.get("DATABASE_URL"):
        print("BLOCKED: isolated DATABASE_URL required for selected Go/PostgreSQL proofs", file=sys.stderr)
        return 1
    output = Path(tempfile.mkdtemp(prefix="granete-verification-"))
    print("Local logs (may contain fixture data; do not upload without review): " + str(output), flush=True)
    for name, command, cwd in tasks:
        started = time.monotonic()
        remaining = deadline - started
        if remaining <= 0:
            print("BLOCKED_BUDGET: no approved time remains", file=sys.stderr)
            return 124
        log = output / (name + ".log")
        try:
            with log.open("w", encoding="utf-8") as stream:
                returncode = run_bounded(command, cwd, stream, remaining)
        except OSError:
            print(name + ": BLOCKED (command unavailable); " + str(log), file=sys.stderr)
            return 1
        print(f"{name}: {'PASS' if returncode == 0 else 'FAIL'} ({time.monotonic() - started:.1f}s); {log}", flush=True)
        if returncode == 124:
            print("BLOCKED_BUDGET: timed-out command process group terminated; no automatic retry", file=sys.stderr)
            return 124
        if returncode:
            # No full-suite output inflation. Retain complete local evidence.
            with log.open(encoding="utf-8", errors="replace") as stream:
                from collections import deque
                print("".join(deque(stream, maxlen=60)), file=sys.stderr)
            return 1
    print("Selected local proofs complete; independent review, CI and issue-specific host/machine gates remain required.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
