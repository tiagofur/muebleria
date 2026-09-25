"""Harness behavior tests; stubs here are NOT database/host/product evidence."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ci_impact import JOBS, classify, full
import factory_preflight
import verify_affected

ROOT = Path(__file__).resolve().parents[1]


class FoundationPartitionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        shutil.copyfile(ROOT / "scripts/foundation-gate-a.sh", self.root / "scripts/foundation-gate-a.sh")
        self.trace = self.root / "trace"
        self.env = {**os.environ, "PATH": str(self.bin), "TRACE": str(self.trace)}
        for name in ("bash", "dirname", "mktemp", "rm", "tee", "grep", "env"):
            target = shutil.which(name)
            self.assertIsNotNone(target)
            (self.bin / name).symlink_to(target)
        for name in ("go", "python3", "pg_dump", "pg_restore", "docker"):
            self.executable(self.bin / name, "exit 0")
        self.executable(self.bin / "git", 'echo git >> "$TRACE"')
        self.executable(self.bin / "pnpm", 'echo "pnpm $*" >> "$TRACE"; exit "${PNPM_EXIT:-0}"')
        for file, label in (("smoke-deploy.sh", "smoke"), ("pilot-gate.sh", "postgres"), ("organization-browser-gate.sh", "browser")):
            self.executable(self.root / "scripts" / file,
                            f'echo {label} >> "$TRACE"\n'
                            f'if [ "${{SKIP_STAGE:-}}" = {label} ]; then echo "--- SKIP: proof"; fi\n'
                            f'if [ "${{FAIL_STAGE:-}}" = {label} ]; then exit 7; fi\nexit 0')

    def executable(self, path, body):
        path.write_text("#!/usr/bin/env bash\n" + body + "\n")
        path.chmod(0o755)

    def run_gate(self, *args):
        return subprocess.run([shutil.which("bash"), str(self.root / "scripts/foundation-gate-a.sh"), *args],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def calls(self):
        return self.trace.read_text().splitlines() if self.trace.exists() else []

    def test_default_preserves_all_original_stages(self):
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ["pnpm openapi:check", "pnpm typecheck", "pnpm test", "smoke", "postgres", "browser", "git"])

    def test_postgres_stage_contains_no_duplicate_typescript(self):
        result = self.run_gate("--stage", "postgres")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ["smoke", "postgres", "git"])

    def test_browser_stage_contains_no_duplicate_typescript(self):
        result = self.run_gate("--stage", "browser")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ["browser", "git"])

    def test_bad_stage_rejected_before_work(self):
        self.assertNotEqual(self.run_gate("--stage", "skip").returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_nonzero_test_exit_is_fatal(self):
        self.env["FAIL_STAGE"] = "postgres"
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertNotIn("browser", self.calls())

    def test_typescript_failure_cannot_be_swallowed(self):
        self.env["PNPM_EXIT"] = "9"
        self.assertNotEqual(self.run_gate().returncode, 0)
        self.assertEqual(self.calls(), ["pnpm openapi:check"])

    def test_skipped_required_proof_is_fatal(self):
        for stage in ("postgres", "browser"):
            self.env["SKIP_STAGE"] = stage
            self.assertNotEqual(self.run_gate("--stage", stage).returncode, 0)

    def test_missing_infrastructure_is_not_green(self):
        (self.bin / "go").unlink()
        result = self.run_gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required", result.stderr)
        self.assertEqual(self.calls(), [])


class PreflightTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "docs").mkdir()
        for path in ("AGENTS.md", "docs/verification.md"):
            (self.root / path).write_text("fixture")
        for args in (("init", "-q"), ("config", "user.name", "Test"), ("config", "user.email", "test@example.invalid"), ("add", "."), ("commit", "-qm", "fixture")):
            subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True)

    def test_read_only_no_tests_no_installs(self):
        before = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        state = factory_preflight.inspect(self.root)
        after = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(state["status"], "PREFLIGHT_OK_NOT_VERIFIED")
        self.assertEqual(state["tests"], "NOT_RUN")
        self.assertEqual(before, after)

    def test_missing_requested_tool_blocks(self):
        actual = shutil.which
        with patch.object(factory_preflight.shutil, "which", side_effect=lambda key: None if key == "go" else actual(key)):
            self.assertEqual(factory_preflight.inspect(self.root, ("go",))["status"], "BLOCKED")

    def test_dirty_resume_visible_and_clean_handoff_enforced(self):
        (self.root / "AGENTS.md").write_text("changed")
        self.assertTrue(factory_preflight.inspect(self.root)["dirty"])
        self.assertEqual(factory_preflight.inspect(self.root, require_clean=True)["status"], "BLOCKED")

    def test_global_catalog_is_not_a_startup_dependency(self):
        self.assertFalse((self.root / "feature_list.json").exists())
        self.assertEqual(
            factory_preflight.inspect(self.root)["status"],
            "PREFLIGHT_OK_NOT_VERIFIED",
        )
        (self.root / "feature_list.json").write_text("{not-json")
        self.assertEqual(
            factory_preflight.inspect(self.root)["status"],
            "PREFLIGHT_OK_NOT_VERIFIED",
        )


class WiringTest(unittest.TestCase):
    def test_ci_keeps_critical_guards_and_same_check_names(self):
        text = (ROOT / ".github/workflows/ci.yml").read_text()
        for fragment in ("if: ${{ always() }}", "name: Foundation Gate A", "name: Go Backend Tests",
                         "storage-shard-plan:", "storage-shards:", "backend-go-other:",
                         "scripts/backend-test-storage-shard.sh 3", "scripts/backend-test.sh -timeout=30m -v",
                         "os: [ubuntu-latest, macos-latest, windows-latest]", "fetch-depth: 0",
                         "scripts/ci_result.py", "toJSON(needs)", "contents: read"):
            self.assertIn(fragment, text)
        self.assertNotIn("DATABASE_URL: postgres://postgres", text)
        self.assertNotIn("go test -p 1 -timeout=30m -v ./...", text)
        self.assertNotIn("continue-on-error", text)
        self.assertNotIn("pull_request_target", text)
        self.assertEqual(len(re.findall(r"^\s+- run: pnpm typecheck$", text, re.M)), 1)
        self.assertEqual(len(re.findall(r"^\s+- run: pnpm test$", text, re.M)), 1)
        # No workflow-level path filters: every PR still gets an aggregate.
        self.assertNotIn("paths-ignore:", text)
        self.assertNotIn("paths:", text.split("jobs:")[0])
        final = text.split("  foundation-gate-a:")[1]
        for job in JOBS:
            self.assertIn(job, final.split("    if:")[0])

    def test_local_plan_never_reexecutes_all_foundation_after_typescript(self):
        tasks = verify_affected.commands(full("test"))
        rendered = [" ".join(cmd) for _, cmd, _ in tasks]
        self.assertEqual(rendered.count("pnpm test"), 1)
        self.assertEqual(rendered.count("pnpm typecheck"), 1)
        self.assertIn("bash scripts/foundation-gate-a.sh --stage postgres", rendered)
        self.assertIn("bash scripts/foundation-gate-a.sh --stage browser", rendered)
        self.assertNotIn("pnpm gate:foundation:a", rendered)

    def test_react_local_plan_has_browser_not_go_suite(self):
        tasks = verify_affected.commands(classify(["packages/ui/src/help.tsx"]))
        names = {name for name, _, _ in tasks}
        self.assertIn("browser", names)
        self.assertNotIn("backend-go", names)
        self.assertNotIn("sketchup-local-os", names)

class BudgetTest(unittest.TestCase):
    def test_nonzero_exit_preserved(self):
        with tempfile.TemporaryFile(mode="w+") as output:
            self.assertEqual(verify_affected.run_bounded([shutil.which("bash"), "-c", "exit 7"], ROOT, output, 2), 7)

    def test_timeout_stops_command_and_returns_blocked_code(self):
        with tempfile.TemporaryFile(mode="w+") as output:
            self.assertEqual(verify_affected.run_bounded([shutil.which("bash"), "-c", "sleep 30"], ROOT, output, 0.05), 124)


if __name__ == "__main__":
    unittest.main()
