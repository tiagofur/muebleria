"""Conservative component selection; no external packages or GitHub diff limits.

CI compares the actual tested merge tree to its exact base, not a list truncated
by the pull-request API. A missing/invalid input selects every suite, never none.
Local plans include committed, staged, unstaged and non-ignored untracked files.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 1
JOBS = ("typescript", "backend-go", "sketchup-extension", "proyectar-visual",
        "foundation-postgres", "organization-browser")
SHA = re.compile(r"[0-9a-f]{40}")
SENSITIVE = re.compile(
    r"auth|permission|rbac|session|tenant|organization|membership|release|"
    r"migration|contract|schema|transport|credential|security|pairing|enrollment",
    re.I,
)
# These Markdown files are inputs to executable gates/instruction contracts.
EXECUTABLE_DOCS = {"docs/deployment.md", "docs/verification.md", "docs/design.md",
                   "docs/architecture.md", "docs/conventions.md"}
WEB_PROOFS = ("typescript", "organization-browser", "proyectar-visual")


def full(reason: str) -> dict:
    return {"schema": SCHEMA, "jobs": dict.fromkeys(JOBS, True), "reasons": [reason]}


def valid_path(path: str) -> bool:
    return (isinstance(path, str) and bool(path) and not path.startswith("/")
            and "\\" not in path and ".." not in PurePosixPath(path).parts
            and all(ord(char) >= 32 and ord(char) != 127 for char in path))


def classify(paths) -> dict:
    paths = list(paths)
    if not paths:
        return full("empty-diff: conservative full verification")
    jobs = dict.fromkeys(JOBS, False)
    reasons = set()
    for path in paths:
        if not valid_path(path):
            return full("invalid-path: conservative full verification")
        if path in EXECUTABLE_DOCS or path.startswith("docs/demo/software-factory"):
            return full("executable documentation or factory policy changed")
        if ((path.startswith(("docs/", "progress/")) and path.endswith(".md"))
                or path == "README.md"):
            reasons.add("documentation")
            continue
        if SENSITIVE.search(path):
            return full("sensitive boundary or shared contract changed")
        if path.startswith(("packages/domain/", "packages/storage/", "backend-go/", "contracts/")):
            return full("shared domain, persistence or backend changed")
        if path.startswith(("apps/web/src/", "packages/ui/src/")):
            for key in WEB_PROOFS:
                jobs[key] = True
            reasons.add("web: TypeScript + real browser + visual regression")
        elif path.startswith("apps/sketchup-extension/"):
            # Keep the complete Ruby/JS/RBZ matrix. Real-host acceptance remains
            # an additional issue-specific gate; this does not claim TestUp.
            jobs["sketchup-extension"] = True
            reasons.add("SketchUp: complete portable matrix")
        elif path.startswith(("apps/mobile/src/", "apps/desktop/src/", "packages/excel/src/")):
            for key in WEB_PROOFS:
                jobs[key] = True
            reasons.add("TypeScript consumers")
        elif path.startswith("tests/visual/"):
            jobs["typescript"] = jobs["proyectar-visual"] = True
            reasons.add("visual tests")
        else:
            # Config, scripts, lockfiles, fixture formats, new directories and
            # unclassified test/support changes cannot quietly bypass a gate.
            return full("global, tooling or unknown input changed")
    return {"schema": SCHEMA, "jobs": jobs, "reasons": sorted(reasons)}


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL)


def resolve(root: Path, ref: str) -> str:
    if not ref or ref.startswith("-"):
        raise ValueError("invalid ref")
    sha = git(root, "rev-parse", "--verify", ref + "^{commit}").decode().strip()
    if not SHA.fullmatch(sha):
        raise ValueError("invalid commit")
    return sha


def decode_paths(raw: bytes) -> list[str]:
    return [path.decode("utf-8", errors="strict") for path in raw.split(b"\0") if path]


def changed_paths(root: Path, base: str, head: str, include_worktree: bool = False) -> list[str]:
    base_sha, head_sha = resolve(root, base), resolve(root, head)
    # --no-renames preserves BOTH deletion and addition. NUL delimiters retain
    # spaces/newlines correctly; classify rejects ambiguous/control paths.
    paths = decode_paths(git(root, "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base_sha, head_sha, "--"))
    if include_worktree:
        if resolve(root, "HEAD") != head_sha:
            raise ValueError("working tree does not correspond to requested HEAD")
        paths += decode_paths(git(root, "diff", "--cached", "--no-ext-diff", "--no-renames", "--name-only", "-z", head_sha, "--"))
        paths += decode_paths(git(root, "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", head_sha, "--"))
        paths += decode_paths(git(root, "ls-files", "--others", "--exclude-standard", "-z"))
    return sorted(set(paths))


def plan_for_ci(root: Path, event_name: str, event: dict, tested_sha: str) -> dict:
    if event_name != "pull_request":
        plan = full("non-PR event: complete verification")
        plan["tested_sha"] = tested_sha
        return plan
    try:
        base, head = event["pull_request"]["base"]["sha"], event["pull_request"]["head"]["sha"]
        if not all(isinstance(sha, str) and SHA.fullmatch(sha) for sha in (base, head, tested_sha)):
            raise ValueError("missing exact pins")
        if resolve(root, "HEAD") != tested_sha:
            raise ValueError("checkout mismatch")
        parents = git(root, "show", "-s", "--format=%P", tested_sha).decode().split()
        if parents != [base, head]:
            raise ValueError("not the exact pull-request merge tree")
        plan = classify(changed_paths(root, base, tested_sha))
        plan.update(base_sha=base, head_sha=head, tested_sha=tested_sha)
        return plan
    except (KeyError, TypeError, ValueError, OSError, subprocess.CalledProcessError, UnicodeError):
        plan = full("unavailable or mismatched CI diff: complete verification")
        plan["tested_sha"] = tested_sha
        return plan


def local_plan(root: Path, base: str | None, head: str = "HEAD", force_full: bool = False) -> dict:
    try:
        head_sha = resolve(root, head)
        if force_full or not base:
            plan = full("explicit full verification or missing local base")
        else:
            base_sha = resolve(root, base)
            # Union against merge-base AND current target: do not omit changes
            # from either side while a local branch is behind its target.
            ancestor = git(root, "merge-base", base_sha, head_sha).decode().strip()
            paths = changed_paths(root, ancestor, head_sha, True)
            paths += changed_paths(root, base_sha, head_sha, True)
            plan = classify(paths)
            plan["base_sha"] = base_sha
        plan["tested_sha"] = head_sha
        plan["includes_worktree"] = True
        return plan
    except (ValueError, OSError, subprocess.CalledProcessError, UnicodeError):
        return full("unavailable local diff: complete verification")


def validate_plan(plan: dict) -> None:
    if not isinstance(plan, dict) or type(plan.get("schema")) is not int or plan["schema"] != SCHEMA:
        raise ValueError("invalid plan schema")
    jobs = plan.get("jobs")
    if not isinstance(jobs, dict) or set(jobs) != set(JOBS) or any(type(value) is not bool for value in jobs.values()):
        raise ValueError("invalid expected suite set")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ci", action="store_true")
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--full", action="store_true", help="expand to every suite; never suppress gates")
    args = parser.parse_args()
    if args.ci:
        try:
            with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as source:
                event = json.load(source)
        except (KeyError, OSError, ValueError):
            event = {}
        plan = plan_for_ci(ROOT, os.environ.get("GITHUB_EVENT_NAME", ""), event, os.environ.get("GITHUB_SHA", ""))
    else:
        plan = local_plan(ROOT, args.base, args.head, args.full)
    validate_plan(plan)
    serialized = json.dumps(plan, sort_keys=True, separators=(",", ":"))
    print(serialized)
    if args.ci and os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write("plan=" + serialized + "\n")
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
                summary.write("## Verification impact\n\n```json\n" + json.dumps(plan, indent=2) + "\n```\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
