"""Fail-closed guard: packaged SketchUp extension content requires a version bump (#1251).

Every file under ``apps/sketchup-extension/src/`` ships in the RBZ (see the
``runtime_files`` helper in the extension Rakefile). If any of them differs
from the base while ``EXTENSION_VERSION`` (identity.rb, the only source) does
not strictly increase, two different packages would circulate under one number.

CI compares the exact tested merge commit with its real base (first parent of
the pull-request merge commit, or the merge-group base). The guard reads git
objects only: no worktree state, network or Ruby is involved.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = "apps/sketchup-extension/src/"
IDENTITY = SRC + "granete_for_sketchup/identity.rb"
SHA = re.compile(r"[0-9a-f]{40}")
VERSION_LINE = re.compile(r"EXTENSION_VERSION\s*=\s*'([^']*)'")
SEMVER = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)")


class GuardError(Exception):
    """The guard cannot prove the policy: callers must fail."""


def git(root: Path, *args: str) -> bytes:
    try:
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError) as error:
        raise GuardError("git " + " ".join(args[:2]) + " failed") from error


def resolve(root: Path, ref: str) -> str:
    if not ref or ref.startswith("-"):
        raise GuardError("invalid ref")
    sha = git(root, "rev-parse", "--verify", ref + "^{commit}").decode().strip()
    if not SHA.fullmatch(sha):
        raise GuardError("invalid commit")
    return sha


def identity_text(root: Path, sha: str) -> str:
    return git(root, "show", f"{sha}:{IDENTITY}").decode("utf-8")


def parse_version(text: str) -> tuple[int, int, int]:
    found = VERSION_LINE.findall(text)
    if len(found) != 1:
        raise GuardError("identity.rb must declare EXTENSION_VERSION exactly once")
    match = SEMVER.fullmatch(found[0])
    if not match:
        raise GuardError(f"EXTENSION_VERSION {found[0]!r} is not MAJOR.MINOR.PATCH")
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def packaged_changes(root: Path, base: str, head: str) -> list[str]:
    """Paths under src/ whose content differs, ignoring a version-only identity edit."""
    raw = git(root, "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, head, "--", SRC)
    paths = sorted(p.decode("utf-8") for p in raw.split(b"\0") if p)
    if IDENTITY in paths:
        neutral = [VERSION_LINE.sub("EXTENSION_VERSION = '<v>'", identity_text(root, sha)) for sha in (base, head)]
        if neutral[0] == neutral[1]:
            paths.remove(IDENTITY)
    return paths


def check(root: Path, base: str, head: str) -> str:
    """Return a PASS message or raise GuardError describing the violation."""
    base_sha, head_sha = resolve(root, base), resolve(root, head)
    base_version = parse_version(identity_text(root, base_sha))
    head_version = parse_version(identity_text(root, head_sha))
    shown = lambda v: ".".join(map(str, v))  # noqa: E731
    changes = packaged_changes(root, base_sha, head_sha)
    if head_version < base_version:
        raise GuardError(f"EXTENSION_VERSION went backwards: {shown(base_version)} -> {shown(head_version)}")
    if not changes:
        return f"PASS: no packaged extension change; version {shown(head_version)} (base {shown(base_version)})"
    if head_version == base_version:
        listing = "\n".join("  - " + path for path in changes[:20])
        more = f"\n  ... and {len(changes) - 20} more" if len(changes) > 20 else ""
        raise GuardError(
            f"{len(changes)} packaged file(s) under {SRC} changed but EXTENSION_VERSION stayed "
            f"{shown(base_version)}.\n{listing}{more}\n"
            f"Bump EXTENSION_VERSION in {IDENTITY} (the only source) so the RBZ is distinguishable."
        )
    return f"PASS: {len(changes)} packaged change(s) with bump {shown(base_version)} -> {shown(head_version)}"


def ci_refs(root: Path, event_name: str, event: dict, tested_sha: str) -> tuple[str, str] | None:
    """Exact (base, head) for the tested commit, or None for events with no comparison base."""
    if event_name not in ("pull_request", "merge_group"):
        return None
    if not SHA.fullmatch(tested_sha or "") or resolve(root, "HEAD") != tested_sha:
        raise GuardError("checkout does not match the tested commit")
    if event_name == "merge_group":
        base = event.get("merge_group", {}).get("base_sha")
        if not isinstance(base, str) or not SHA.fullmatch(base):
            raise GuardError("merge_group event has no exact base_sha")
        return base, tested_sha
    parents = git(root, "show", "-s", "--format=%P", tested_sha).decode().split()
    if len(parents) != 2:
        raise GuardError("tested commit is not a pull-request merge commit")
    # First parent is the target branch tip actually merged: the true comparison base.
    return parents[0], tested_sha


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ci", action="store_true")
    parser.add_argument("--base", help="local mode: target ref, compared from its merge-base with --head")
    parser.add_argument("--head", default="HEAD")
    args = parser.parse_args()
    try:
        if args.ci:
            try:
                with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as source:
                    event = json.load(source)
            except (KeyError, OSError, ValueError) as error:
                raise GuardError("event payload unavailable") from error
            refs = ci_refs(ROOT, os.environ.get("GITHUB_EVENT_NAME", ""), event, os.environ.get("GITHUB_SHA", ""))
            if refs is None:
                print("SKIP: no pull-request/merge-group base for this event (not a PASS)")
                return 0
        elif args.base:
            head = resolve(ROOT, args.head)
            refs = (git(ROOT, "merge-base", resolve(ROOT, args.base), head).decode().strip(), head)
        else:
            parser.error("--ci or --base is required")
        print(check(ROOT, *refs))
    except GuardError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
