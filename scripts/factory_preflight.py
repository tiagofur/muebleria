"""Read-only session preflight: not proof that product tests passed."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ("git", "node", "pnpm", "go", "ruby", "bundle", "docker")


def inspect(root, required=(), require_clean=False):
    tools = {name: shutil.which(name) is not None for name in TOOLS}
    errors = ["missing required tool: " + name for name in {"git", *required} if not tools.get(name)]
    state = {"tests": "NOT_RUN", "tools": tools, "errors": errors}
    for name in ("AGENTS.md", "docs/verification.md"):
        if not (root / name).is_file():
            errors.append("missing harness file: " + name)
    try:
        def git(*args):
            return subprocess.check_output(["git", "--no-optional-locks", "-C", str(root), *args], stderr=subprocess.DEVNULL)
        state["head"] = git("rev-parse", "--verify", "HEAD").decode().strip()
        state["branch"] = git("symbolic-ref", "--quiet", "--short", "HEAD").decode().strip()
        state["dirty"] = bool(git("status", "--porcelain=v1", "-z"))
        if git("diff", "--name-only", "--diff-filter=U", "-z"):
            errors.append("unresolved merge conflicts")
        if require_clean and state["dirty"]:
            errors.append("worktree is not clean")
    except (OSError, subprocess.CalledProcessError):
        errors.append("missing repository, commit or attached branch")
    if "node" in required and tools["node"]:
        try:
            version = subprocess.check_output(["node", "--version"], text=True).strip()
            match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version)
            if not match or tuple(map(int, match.groups())) < (22, 13, 0):
                errors.append("Node >=22.13 is required by the pinned pnpm")
        except (OSError, subprocess.CalledProcessError):
            errors.append("Node version unavailable")
    state["status"] = "BLOCKED" if errors else "PREFLIGHT_OK_NOT_VERIFIED"
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--require", nargs="*", choices=TOOLS, default=[])
    parser.add_argument("--require-clean", action="store_true")
    args = parser.parse_args()
    state = inspect(ROOT, args.require, args.require_clean)
    print(json.dumps(state, indent=2, sort_keys=True))
    return 1 if state["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
