#!/usr/bin/env python3
"""Validate the stable product-capability catalog deterministically."""

import argparse
import json
from pathlib import Path, PurePosixPath
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "feature_list.json"
TOP_LEVEL_KEYS = {"schema_version", "project", "purpose", "features"}
FEATURE_KEYS = {"id", "title", "summary", "canonical_docs"}
OPERATIONAL_KEYS = {
    "acceptance",
    "blocked",
    "branch",
    "category",
    "completedAt",
    "created",
    "createdAt",
    "depends_on",
    "evidence",
    "github_issue",
    "in_progress",
    "lane",
    "owner",
    "phase",
    "priority",
    "queue",
    "reservation",
    "review_notes",
    "scheduler",
    "status",
    "type",
}
IDENTIFIER = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
OPERATIONAL_TITLE = re.compile(
    r"\b(?:bug(?:fix)?|css|fix(?:es)?|hardening|refactor|review|slice|tests?)\b",
    re.IGNORECASE,
)


class CatalogError(ValueError):
    """Raised when the capability catalog violates its stable schema."""


def _nonempty_string(value, field):
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise CatalogError(f"{field} must be a non-empty trimmed string")


def validate_data(data, root=ROOT):
    if not isinstance(data, dict) or set(data) != TOP_LEVEL_KEYS:
        raise CatalogError(f"top-level keys must be exactly {sorted(TOP_LEVEL_KEYS)}")
    if data["schema_version"] != 2:
        raise CatalogError("schema_version must be 2")
    if data["project"] != "muebleria":
        raise CatalogError("project must be muebleria")
    _nonempty_string(data["purpose"], "purpose")

    features = data["features"]
    if not isinstance(features, list) or not 5 <= len(features) <= 30:
        raise CatalogError("features must contain 5 to 30 high-level capabilities")

    seen = set()
    for index, feature in enumerate(features):
        label = f"features[{index}]"
        if not isinstance(feature, dict):
            raise CatalogError(f"{label} must be an object")
        extra = set(feature) - FEATURE_KEYS
        if extra:
            operational = extra & OPERATIONAL_KEYS
            if operational:
                raise CatalogError(
                    f"{label} contains operational fields: {sorted(operational)}"
                )
            raise CatalogError(f"{label} contains unsupported fields: {sorted(extra)}")
        missing = FEATURE_KEYS - set(feature)
        if missing:
            raise CatalogError(f"{label} is missing fields: {sorted(missing)}")

        identifier = feature["id"]
        if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
            raise CatalogError(f"{label}.id must be a lowercase hyphenated identifier")
        if identifier in seen:
            raise CatalogError(f"duplicate feature id: {identifier}")
        seen.add(identifier)

        _nonempty_string(feature["title"], f"{label}.title")
        _nonempty_string(feature["summary"], f"{label}.summary")
        if OPERATIONAL_TITLE.search(feature["title"]):
            raise CatalogError(f"{label}.title describes operational work")

        docs = feature["canonical_docs"]
        if not isinstance(docs, list) or not docs:
            raise CatalogError(f"{label}.canonical_docs must be a non-empty list")
        seen_docs = set()
        for doc in docs:
            _nonempty_string(doc, f"{label}.canonical_docs[]")
            if doc in seen_docs:
                raise CatalogError(f"{label}.canonical_docs must be unique")
            seen_docs.add(doc)
            relative = PurePosixPath(doc)
            if relative.is_absolute() or ".." in relative.parts:
                raise CatalogError(f"{label}.canonical_docs contains an unsafe path")
            if not (root / relative).is_file():
                raise CatalogError(f"{label}.canonical_docs does not exist: {doc}")

    return len(features)


def validate_file(path=DEFAULT_CATALOG):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalogError(f"cannot read catalog: {exc}") from exc
    return validate_data(data, ROOT)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", default=DEFAULT_CATALOG)
    args = parser.parse_args(argv)
    try:
        count = validate_file(args.path)
    except CatalogError as exc:
        print(f"[FAIL] feature_list.json: {exc}", file=sys.stderr)
        return 1
    print(f"[OK] feature_list.json: {count} high-level product capabilities")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
