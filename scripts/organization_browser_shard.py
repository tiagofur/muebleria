"""Deterministic three-way file split for the organization browser gate.

Every shard runs its own disposable stack (PostgreSQL container + backend +
Vite) through organization-browser-gate.sh, so the only thing this script owns
is WHICH spec files each shard executes. Correctness invariants:

- The union of all shards is EXACTLY tests/organization/*.spec.ts — a new spec
  file can never be silently dropped, and no file may run twice.
- Assignment is a pure function of (glob, timings file, shard count): the plan
  job and every shard job compute the identical split without artifacts.
- Files are never split below file level, so describe.serial groups stay whole.
- Unknown files (not yet in the timings baseline) get a conservative default
  weight so balance degrades gracefully instead of failing.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC_GLOB = "tests/organization/*.spec.ts"
DEFAULT_TIMINGS = ROOT / "tests/organization/testdata/browser-shard-timings.json"
SCHEMA = 1


def load_timings(path: Path) -> tuple[float, dict[str, float]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"unreadable timings baseline {path}: {error}") from error
    if not isinstance(raw, dict) or raw.get("schema") != SCHEMA:
        raise ValueError("timings baseline schema mismatch")
    default = raw.get("default_seconds")
    files = raw.get("files")
    if not isinstance(default, (int, float)) or default <= 0 or not isinstance(files, dict):
        raise ValueError("timings baseline needs default_seconds > 0 and a files map")
    weights = {}
    for name, seconds in files.items():
        if not isinstance(name, str) or not isinstance(seconds, (int, float)) or seconds < 0:
            raise ValueError(f"invalid timings entry {name!r}")
        weights[name] = float(seconds)
    return float(default), weights


def spec_files(root: Path) -> list[str]:
    files = sorted(
        str(path.relative_to(root))
        for path in (root / "tests/organization").glob("*.spec.ts")
    )
    if not files:
        raise ValueError("no organization spec files found")
    return files


def compute_shards(files: list[str], default_seconds: float, weights: dict[str, float], shards: int) -> list[list[str]]:
    """Longest-processing-time-first over per-file weights, deterministic ties."""
    if shards < 1:
        raise ValueError("shard count must be >= 1")
    loads: list[float] = [0.0] * shards
    assignment: list[list[str]] = [[] for _ in range(shards)]
    for name in sorted(files, key=lambda f: (-weights.get(f, default_seconds), f)):
        target = min(range(shards), key=lambda i: (loads[i], i))
        assignment[target].append(name)
        loads[target] += weights.get(name, default_seconds)
    return [sorted(shard) for shard in assignment]


def verify_partition(files: list[str], shards: list[list[str]]) -> None:
    if sum(len(shard) for shard in shards) != len(set(files)):
        raise ValueError("shard sizes do not match the unique spec file count")
    seen: set[str] = set()
    for index, shard in enumerate(shards, start=1):
        for name in shard:
            if name in seen:
                raise ValueError(f"{name} assigned to more than one shard")
            seen.add(name)
    missing = set(files) - seen
    if missing:
        raise ValueError(f"files missing from every shard: {sorted(missing)}")
    unexpected = seen - set(files)
    if unexpected:
        raise ValueError(f"shards reference unknown files: {sorted(unexpected)}")


def build_plan(root: Path, timings_path: Path, shards: int) -> list[list[str]]:
    default, weights = load_timings(timings_path)
    files = spec_files(root)
    result = compute_shards(files, default, weights, shards)
    verify_partition(files, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("plan", "files", "verify"))
    parser.add_argument("--shards", type=int, required=True)
    parser.add_argument("--index", type=int, help="1-based shard index for mode=files")
    parser.add_argument("--timings", type=Path, default=DEFAULT_TIMINGS)
    args = parser.parse_args()
    if args.shards < 1:
        print("shard count must be >= 1", file=sys.stderr)
        return 2
    try:
        plan = build_plan(ROOT, args.timings, args.shards)
    except ValueError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    if args.mode == "plan":
        for shard in plan:
            print(" ".join(shard))
    elif args.mode == "verify":
        default, weights = load_timings(args.timings)
        known = sum(1 for name in spec_files(ROOT) if name in weights)
        for index, shard in enumerate(plan, start=1):
            load = sum(weights.get(name, default) for name in shard)
            print(f"shard {index}/{args.shards}: {len(shard)} files, ~{load:.0f}s estimated")
        print(f"PASS: exact partition of {sum(len(s) for s in plan)} spec files ({known} with measured timings)")
    else:
        if not isinstance(args.index, int) or not 1 <= args.index <= args.shards:
            print("mode=files requires --index within [1, shards]", file=sys.stderr)
            return 2
        for name in plan[args.index - 1]:
            print(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
