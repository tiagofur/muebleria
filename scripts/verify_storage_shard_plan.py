#!/usr/bin/env python3
"""Fail closed unless an AST-derived storage shard plan is exact."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
import sys


def read_roots(path: Path) -> list[str]:
    try:
        roots = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    except OSError as error:
        raise ValueError(f"cannot read {path}: {error}") from error
    if not roots or any(not root for root in roots):
        raise ValueError(f"{path} has an empty root selection")
    duplicates = [name for name, count in Counter(roots).items() if count != 1]
    if duplicates:
        raise ValueError(f"{path} repeats roots: {', '.join(sorted(duplicates))}")
    return roots


def verify(all_roots: list[str], shard_roots: list[list[str]]) -> None:
    if not all_roots:
        raise ValueError("AST discovery has an empty root selection")
    if len(shard_roots) < 1:
        raise ValueError("expected at least one shard")
    if any(not roots for roots in shard_roots):
        raise ValueError("a storage shard has zero tests")

    expected = set(all_roots)
    assigned = Counter(root for roots in shard_roots for root in roots)
    unexpected = sorted(set(assigned) - expected)
    missing = sorted(expected - set(assigned))
    duplicates = sorted(root for root, count in assigned.items() if count != 1)
    if unexpected or missing or duplicates:
        details = []
        if unexpected:
            details.append("unexpected=" + ",".join(unexpected))
        if missing:
            details.append("missing=" + ",".join(missing))
        if duplicates:
            details.append("duplicate=" + ",".join(duplicates))
        raise ValueError("invalid shard coverage: " + " ".join(details))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", type=Path, required=True, help="AST-discovered roots")
    parser.add_argument("--shard", type=Path, action="append", required=True, help="one shard root list")
    args = parser.parse_args()
    try:
        all_roots = read_roots(args.all)
        shard_roots = [read_roots(path) for path in args.shard]
        verify(all_roots, shard_roots)
    except ValueError as error:
        print(f"FAIL: storage shard plan: {error}", file=sys.stderr)
        return 1

    counts = "/".join(str(len(roots)) for roots in shard_roots)
    print(
        "PASS: storage shard plan "
        f"AST roots={len(all_roots)} union=complete intersections=empty "
        f"cardinality=exact shards={len(shard_roots)} counts={counts}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
