"""Deterministic clean-context review bundle; advisory, never approves or merges."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Surfaces whose mutation always justifies blind dual review (judgment-day).
HIGH_RISK_PATH_PREFIXES = (
    "backend-go/db/migration/",
    "contracts/",
    "scripts/",
    ".github/workflows/",
    "docs/architecture/adr/",
    ".agents/skills/",
)

# Root guardrail files named by the clean-context protocol's trigger list;
# startswith prefixes and keywords do not catch them.
HIGH_RISK_EXACT_PATHS = (
    "AGENTS.md",
    "CHECKPOINTS.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
)

HIGH_RISK_KEYWORDS = (
    "migration",
    "auth",
    "security",
    "permission",
    "secret",
    "crypto",
    "session",
    "token",
    "rls",
    "lock",
)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        # argparse normally echoes untrusted argument values.
        raise ValueError("Invalid arguments")


def run_git(root, *args):
    result = subprocess.run(
        ["git", *args], cwd=str(root), capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError("git command failed")
    return result.stdout


def detect_high_risk(changed_files):
    triggers = []
    for path in changed_files:
        lowered = path.lower()
        if path in HIGH_RISK_EXACT_PATHS or any(
            path.startswith(prefix) for prefix in HIGH_RISK_PATH_PREFIXES
        ):
            triggers.append("sensitive-surface:" + path)
        elif any(keyword in lowered for keyword in HIGH_RISK_KEYWORDS):
            triggers.append("high-risk-keyword:" + path)
    return sorted(set(triggers))


def build_bundle(root, base, head, issue, acceptance, verification_note):
    """Observe the pinned diff once; any later commit invalidates the digest."""
    if type(issue) is not int or issue <= 0:
        raise ValueError("Invalid arguments")
    for ref in (base, head):
        if not isinstance(ref, str) or not ref.strip():
            raise ValueError("Invalid arguments")
    base_sha = run_git(root, "rev-parse", base).strip()
    head_sha = run_git(root, "rev-parse", head).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", base_sha) or not re.fullmatch(
        r"[0-9a-f]{40}", head_sha
    ):
        raise ValueError("Invalid arguments")
    # Two-dot endpoint diff: the patch always corresponds to the two pinned
    # SHAs even when base is not an ancestor of head; three-dot would silently
    # diff from the merge-base instead of the pinned base.
    names = run_git(root, "diff", "--name-only", base_sha, head_sha)
    stat = run_git(root, "diff", "--stat", base_sha, head_sha).strip()
    patch = run_git(root, "diff", base_sha, head_sha)
    changed_files = [line.strip() for line in names.splitlines() if line.strip()]
    triggers = detect_high_risk(changed_files)
    scope = json.dumps(
        {
            "issue": issue,
            "base_sha": base_sha,
            "head_sha": head_sha,
            "changed_files": changed_files,
            "diff_sha256": hashlib.sha256(patch.encode()).hexdigest(),
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    scope_sha256 = hashlib.sha256(scope.encode()).hexdigest()
    return {
        "schema": "granete.factory.clean-context-review-bundle.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "context_isolation": "STATELESS_CLEAN_CONTEXT_NO_CHAT_HISTORY",
        "authority": "advisory-bundle-not-an-approval",
        "issue": issue,
        "base_sha": base_sha,
        "head_sha": head_sha,
        "scope_sha256": scope_sha256,
        "changed_files": changed_files,
        "diff_stat": stat,
        "acceptance_criteria": acceptance,
        "verification_note": verification_note,
        "high_risk_triggers": triggers,
        "judgment_day_required": bool(triggers),
        "diff": patch,
    }


def render_markdown(bundle):
    lines = [
        "# Clean-context review bundle — issue #%d" % bundle["issue"],
        "",
        "> Generated deterministically from git state. Do NOT read the",
        "> implementer's conversation history. Evaluate the diff against the",
        "> approved issue, `AGENTS.md`, and `CHECKPOINTS.md`. This bundle is",
        "> advisory: it approves, reserves, and merges nothing.",
        "",
        "## Pinned identity",
        "- **Issue**: `#%d`" % bundle["issue"],
        "- **Base SHA**: `%s`" % bundle["base_sha"],
        "- **Head SHA**: `%s`" % bundle["head_sha"],
        "- **Scope digest (SHA-256)**: `%s`" % bundle["scope_sha256"],
        "- **Judgment-day dual review required**: `%s`"
        % str(bundle["judgment_day_required"]).lower(),
        "",
        "## High-risk triggers",
    ]
    if bundle["high_risk_triggers"]:
        lines.extend("- `%s`" % trigger for trigger in bundle["high_risk_triggers"])
    else:
        lines.append("- None detected")
    lines.extend(
        [
            "",
            "## Acceptance criteria",
            bundle["acceptance_criteria"],
            "",
            "## Observed verification evidence (V0/V1/V2)",
            "```text",
            bundle["verification_note"],
            "```",
            "",
            "## Changed files",
        ]
    )
    lines.extend("- `%s`" % path for path in bundle["changed_files"])
    lines.extend(
        [
            "",
            "## Diff stat",
            "```text",
            bundle["diff_stat"] or "(no file changes)",
            "```",
            "",
            "## Full diff",
            "````diff",
            bundle["diff"],
            "````",
        ]
    )
    return "\n".join(lines) + "\n"


def main(argv=None):
    try:
        parser = Parser(description=__doc__)
        parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
        parser.add_argument("--base", required=True)
        parser.add_argument("--head", default="HEAD")
        parser.add_argument("--issue", required=True, type=int)
        parser.add_argument(
            "--acceptance",
            default="See the approved issue acceptance criteria and exclusions.",
        )
        parser.add_argument(
            "--verification-note",
            default="Implementer-reported V0/V1/V2 evidence; reviewer re-checks it.",
        )
        parser.add_argument("--output-json")
        parser.add_argument("--output-md")
        args = parser.parse_args(argv)
        bundle = build_bundle(
            Path(args.root).resolve(),
            args.base,
            args.head,
            args.issue,
            args.acceptance,
            args.verification_note,
        )
        markdown = render_markdown(bundle)
        for flag, content in ((args.output_json, json.dumps(bundle, indent=2, sort_keys=True) + "\n"), (args.output_md, markdown)):
            if flag:
                target = Path(flag)
                if target.parent.name:
                    target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
        if not args.output_json and not args.output_md:
            sys.stdout.write(markdown)
        else:
            print(
                "BUNDLE_READY issue=%d base=%s head=%s scope_sha256=%s judgment_day=%s"
                % (
                    bundle["issue"],
                    bundle["base_sha"][:7],
                    bundle["head_sha"][:7],
                    bundle["scope_sha256"][:12],
                    str(bundle["judgment_day_required"]).lower(),
                )
            )
    except Exception:
        print("FAIL: bundle unavailable for the requested pins", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
