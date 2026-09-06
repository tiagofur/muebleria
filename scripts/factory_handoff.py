"""Read-only, stateless exact-PR handoff; never dispatches or approves work."""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

import check_pr_metadata as gate

REPOSITORY = "tiagofur/muebleria"


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=True).encode()).hexdigest()


def scope(record):
    gate.require(isinstance(record["title"], str) and isinstance(record["body"], str),
                 "Invalid scope schema")
    return {"title": record["title"], "body": record["body"],
            "labels": sorted(gate.label_names(record))}


def build(number, head, base, issue_number, get=gate.api_get):
    """Observe twice against caller pins; finite reads are not an atomic snapshot."""
    gate.require(type(number) is int and number > 0, "Invalid PR number")
    gate.require(type(issue_number) is int and issue_number > 0, "Invalid issue number")
    for sha in (head, base):
        gate.require(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha),
                     "Invalid SHA")
    event = {"number": number, "repository": {"full_name": REPOSITORY},
             "pull_request": {"head": {"sha": head},
                              "base": {"sha": base, "ref": "main"}}}
    path = f"/repos/{REPOSITORY}/pulls/{number}"

    def snapshot(pr, issue=None):
        linked_number = gate.validate(event, REPOSITORY, pr, issue)
        gate.require(linked_number == issue_number, "Unexpected linked issue")
        gate.require(pr["merged"] is False and pr["merged_at"] is None,
                     "Merged PR")
        gate.require(pr["head"]["repo"]["full_name"] == REPOSITORY,
                     "Fork or missing head repository")
        gate.require(isinstance(pr["head"]["ref"], str) and pr["head"]["ref"],
                     "Missing head ref")
        gate.require(type(pr["draft"]) is bool, "Invalid draft state")
        return issue_number, {**scope(pr), "draft": pr["draft"],
                              "head_ref": pr["head"]["ref"]}

    pr = get(path)
    issue_number, pr_scope = snapshot(pr)
    issue_path = f"/repos/{REPOSITORY}/issues/{issue_number}"
    issue = get(issue_path)
    snapshot(pr, issue)
    issue_scope = scope(issue)
    current_pr = get(path)
    current_issue = get(issue_path)
    current_number, current_scope = snapshot(current_pr, current_issue)
    gate.require(current_number == issue_number and current_scope == pr_scope
                 and scope(current_issue) == issue_scope, "Scope changed during handoff")
    return {"schema_version": 1, "repository": REPOSITORY, "pr": number,
            "issue": issue_number, "head_sha": head, "base_sha": base,
            "base_ref": "main", "pr_scope_sha256": digest(pr_scope),
            "issue_scope_sha256": digest(issue_scope),
            "observed_at": datetime.now(timezone.utc).isoformat(),
            "purpose": "independent-evidence-validation",
            "receipt": "not-issued", "dispatch": "not-started",
            "approval": "none"}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse normally echoes untrusted argument values.
        raise ValueError("Invalid arguments")


def main(argv=None):
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("--pr", required=True, type=int)
        parser.add_argument("--issue", required=True, type=int)
        parser.add_argument("--head", required=True)
        parser.add_argument("--base", required=True)
        args = parser.parse_args(argv)
        gate.require(bool(os.environ.get("GITHUB_TOKEN", "").strip()), "Missing token")
        manifest = build(args.pr, args.head, args.base, args.issue)
    except Exception:
        print("FAIL: handoff unavailable, invalid, unapproved, or stale", file=sys.stderr)
        return 1
    print(json.dumps(manifest, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
