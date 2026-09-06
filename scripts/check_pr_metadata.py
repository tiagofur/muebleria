"""Read-only publication metadata check; not an approval or merge authority."""
import json
import os
import re
import sys
import urllib.request

TYPES = {"type:" + name for name in
         ("bug", "feature", "docs", "refactor", "chore", "breaking-change")}
REFERENCE = re.compile(r"(?:Closes|Fixes|Resolves) #([1-9][0-9]*)", re.I)
TARGET = re.compile(r"\b(?:clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed))\b\s*:?\s*(?:#|https?://|[\w.-]+/|[0-9])", re.I)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def label_names(record):
    labels = record["labels"]
    require(isinstance(labels, list), "Invalid labels schema")
    require(all(isinstance(item, dict) and isinstance(item.get("name"), str)
                for item in labels), "Invalid label schema")
    return [item["name"] for item in labels]


def linked_issue(body):
    require(isinstance(body, str), "Missing PR body")
    lines = [line.strip() for line in body.splitlines() if line.strip()]
    match = REFERENCE.fullmatch(lines[0]) if lines else None
    require(match is not None, "First nonempty line must be Closes/Fixes/Resolves #N")
    require(not any(TARGET.search(line) for line in lines[1:]),
            "Additional closing targets are not allowed")
    return int(match[1])


def validate(event, repository, pr, issue=None):
    """Validate untrusted API/event data without I/O; return the linked number."""
    require(re.fullmatch(r"[\w.-]+/[\w.-]+", repository) is not None,
            "Invalid repository")
    expected = event["pull_request"]
    require(event["repository"]["full_name"] == repository, "Wrong event repository")
    require(type(event["number"]) is int and event["number"] > 0,
            "Invalid PR number")
    require(type(pr["number"]) is int and pr["number"] == event["number"]
            and pr["state"] == "open",
            "PR is not the current open target")
    require(re.fullmatch(r"[0-9a-f]{40}", expected["head"]["sha"]) is not None
            and pr["head"]["sha"] == expected["head"]["sha"], "PR head changed")
    require(pr["base"]["repo"]["full_name"] == repository
            and pr["base"]["ref"] == expected["base"]["ref"]
            and re.fullmatch(r"[0-9a-f]{40}", expected["base"]["sha"]) is not None
            and pr["base"]["sha"] == expected["base"]["sha"], "PR base changed")
    types = [name for name in label_names(pr) if name.startswith("type:")]
    require(len(types) == 1 and types[0] in TYPES, "Exactly one supported type label required")
    number = linked_issue(pr["body"])
    if issue is not None:
        require(type(issue["number"]) is int and issue["number"] == number
                and "pull_request" not in issue,
                "Target must be an issue, not a PR")
        require(issue["url"] == f"https://api.github.com/repos/{repository}/issues/{number}",
                "Issue repository mismatch")
        require(issue["state"] == "open", "Issue must be open")
        statuses = [name for name in label_names(issue) if name.startswith("status:")]
        require(statuses == ["status:approved"], "Issue requires unambiguous human approval")
    return number


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("API redirect refused")


def api_get(path):
    request = urllib.request.Request("https://api.github.com" + path, headers={
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        return json.load(response)


def check(event, repository, get=api_get):
    # Validate routing before putting any event value into an API path.
    require(re.fullmatch(r"[\w.-]+/[\w.-]+", repository) is not None, "Invalid repository")
    number = event["number"]
    require(type(number) is int and number > 0, "Invalid PR number")
    path = f"/repos/{repository}/pulls/{number}"
    pr = get(path)
    issue_number = validate(event, repository, pr)
    issue = get(f"/repos/{repository}/issues/{issue_number}")
    require(isinstance(issue, dict), "Invalid issue response")
    # Re-read the PR after the issue to detect changes during this check.
    current = get(path)
    result = validate(event, repository, current, issue)
    # Identity, head and base are already pinned by validate; ignore volatile API fields.
    require(current["body"] == pr["body"]
            and sorted(label_names(current)) == sorted(label_names(pr)),
            "PR metadata changed during validation")
    return result


def main():
    try:
        with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as source:
            event = json.load(source)
        number = check(event, os.environ["GITHUB_REPOSITORY"])
    except Exception:
        # Exceptions can contain API responses or credentials: never echo them.
        print("FAIL: publication metadata unavailable, invalid, unapproved, or stale", file=sys.stderr)
        return 1
    print(f"PASS: current PR metadata links approved open issue #{number}; not merge authorization")
    return 0


if __name__ == "__main__":
    sys.exit(main())
