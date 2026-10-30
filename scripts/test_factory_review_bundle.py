"""Static guards for the advisory clean-context review bundle generator."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import factory_review_bundle as bundle_script

ROOT = Path(__file__).resolve().parents[1]


class ReviewBundleTest(unittest.TestCase):
    def setUp(self):
        # Each test gets its own repository: commits must never leak between cases.
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for args in (("init", "-q"), ("config", "user.name", "Test"), ("config", "user.email", "test@example.invalid")):
            subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True)
        (self.root / "docs").mkdir()
        (self.root / "docs" / "note.md").write_text("one\n")
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "base"], check=True, capture_output=True)
        self.base = subprocess.run(
            ["git", "-C", str(self.root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()

    def commit_change(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "unit"], check=True, capture_output=True)
        return subprocess.run(
            ["git", "-C", str(self.root), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
        ).stdout.strip()

    def build(self, head="HEAD", issue=42):
        return bundle_script.build_bundle(
            self.root, self.base, head, issue, "S1 observable", "V1 PASS"
        )

    def test_bundle_pins_identity_and_carries_no_chat_history(self):
        state = self.build()
        self.assertEqual(state["schema"], "granete.factory.clean-context-review-bundle.v1")
        self.assertEqual(state["context_isolation"], "STATELESS_CLEAN_CONTEXT_NO_CHAT_HISTORY")
        self.assertEqual(state["authority"], "advisory-bundle-not-an-approval")
        self.assertEqual(state["base_sha"], self.base)
        self.assertEqual(state["issue"], 42)
        self.assertEqual(state["acceptance_criteria"], "S1 observable")
        forbidden = {"chat", "transcript", "rationale", "conversation"}
        self.assertFalse(forbidden & set(state))
        markdown = bundle_script.render_markdown(state)
        for fragment in (self.base, state["scope_sha256"], "S1 observable", "Judgment-day dual review required**: `false`"):
            self.assertIn(fragment, markdown)

    def test_scope_digest_is_deterministic_and_changes_with_diff(self):
        first = self.build()
        second = self.build()
        self.assertEqual(first["scope_sha256"], second["scope_sha256"])
        self.commit_change("docs/note.md", "two\n")
        changed = self.build()
        self.assertNotEqual(first["scope_sha256"], changed["scope_sha256"])
        expected = hashlib.sha256(json.dumps(
            {
                "issue": 42,
                "base_sha": self.base,
                "head_sha": changed["head_sha"],
                "changed_files": ["docs/note.md"],
                "diff_sha256": hashlib.sha256(changed["diff"].encode()).hexdigest(),
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode()).hexdigest()
        self.assertEqual(changed["scope_sha256"], expected)

    def test_high_risk_triggers_and_judgment_day_flag(self):
        self.assertEqual(self.build()["judgment_day_required"], False)
        head = self.commit_change("scripts/new_guard.py", "x = 1\n")
        state = self.build(head=head)
        self.assertEqual(state["high_risk_triggers"], ["sensitive-surface:scripts/new_guard.py"])
        self.assertTrue(state["judgment_day_required"])
        head = self.commit_change("backend-go/internal/api/token_rotation.go", "package api\n")
        state = self.build(head=head)
        self.assertIn("high-risk-keyword:backend-go/internal/api/token_rotation.go", state["high_risk_triggers"])

    def test_invalid_inputs_fail_closed_before_git(self):
        with patch.object(bundle_script, "run_git", side_effect=AssertionError("network reached")):
            for args in ((self.root, self.base, "HEAD", 0, "", ""), (self.root, "", "HEAD", 1, "", "")):
                with self.assertRaises(ValueError):
                    bundle_script.build_bundle(*args)

    def test_cli_writes_bundles_and_prints_summary_without_echoing_secrets(self):
        out_md = self.root / "out" / "review.md"
        out_json = self.root / "out" / "review.json"
        buffer = StringIO()
        with redirect_stdout(buffer):
            code = bundle_script.main([
                "--root", str(self.root), "--base", self.base, "--head", "HEAD",
                "--issue", "42", "--output-md", str(out_md), "--output-json", str(out_json),
            ])
        self.assertEqual(code, 0)
        self.assertIn("BUNDLE_READY issue=42", buffer.getvalue())
        parsed = json.loads(out_json.read_text())
        self.assertEqual(parsed["issue"], 42)
        self.assertIn("Clean-context review bundle", out_md.read_text())

    def test_cli_failure_is_generic_and_nonzero(self):
        buffer = StringIO()
        with redirect_stdout(buffer), patch.object(sys, "stderr", buffer):
            code = bundle_script.main(["--root", str(self.root), "--base", "definitely-not-a-ref", "--head", "HEAD", "--issue", "42"])
        self.assertEqual(code, 1)
        self.assertEqual(buffer.getvalue().strip(), "FAIL: bundle unavailable for the requested pins")


if __name__ == "__main__":
    unittest.main()
