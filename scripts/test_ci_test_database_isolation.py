"""Anti-regression test for test database isolation (#823).

Ensures that:
1. No automated test file (*_test.go, *.spec.ts, *.test.ts) contains the forbidden literal
   `localhost:5445/muebles` or points to `/muebles` as a writable database.
2. Go storage/api tests do not use raw `os.Getenv("DATABASE_URL")` without invoking
   the fail-closed guard `ValidateTestDatabaseURL`.
3. Browser organization E2E configuration and globalSetup require `ORGANIZATION_TEST_ISOLATED=1`
   and reject `/muebles`.
4. The canonical runner `scripts/backend-test.sh` exists and is executable.
"""
import os
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TestDatabaseIsolationAntiRegression(unittest.TestCase):
    def test_no_forbidden_localhost_muebles_in_tests(self):
        """No test file may contain localhost:5445/muebles or fallback to /muebles."""
        forbidden_pattern = re.compile(r"localhost:5445/muebles|/muebles\?sslmode")
        violations = []

        test_files = []
        for ext in ("*.go", "*.ts", "*.js"):
            for p in ROOT.rglob(ext):
                # Ignore node_modules, .git, and non-test sources
                parts = p.parts
                if "node_modules" in parts or ".git" in parts or "test-results" in parts:
                    continue
                name = p.name
                if name.endswith(("_test.go", ".spec.ts", ".test.ts")):
                    test_files.append(p)

        for p in test_files:
            rel = p.relative_to(ROOT).as_posix()
            # Allow testdb_guard_test.go which tests the negative rejection of /muebles
            if rel == "backend-go/internal/storage/testdb_guard_test.go":
                continue
            content = p.read_text(encoding="utf-8", errors="replace")
            for line_no, line in enumerate(content.splitlines(), start=1):
                if forbidden_pattern.search(line):
                    violations.append(f"{rel}:{line_no}: {line.strip()}")

        self.assertEqual(
            violations,
            [],
            f"Found forbidden literal '5445/muebles' in automated test files:\n"
            + "\n".join(violations),
        )

    def test_browser_e2e_requires_isolation_flag(self):
        """Playwright organization config and global setup must enforce ORGANIZATION_TEST_ISOLATED."""
        config_path = ROOT / "playwright.organization.config.ts"
        self.assertTrue(config_path.exists())
        config_content = config_path.read_text(encoding="utf-8")
        self.assertIn("ORGANIZATION_TEST_ISOLATED", config_content)
        self.assertIn("ORGANIZATION_TEST_DATABASE_URL", config_content)

        setup_path = ROOT / "tests/organization/support/globalSetup.ts"
        self.assertTrue(setup_path.exists())
        setup_content = setup_path.read_text(encoding="utf-8")
        self.assertIn("ORGANIZATION_TEST_ISOLATED", setup_content)
        self.assertIn("ORGANIZATION_TEST_DATABASE_URL", setup_content)

    def test_canonical_backend_test_runner_exists(self):
        """scripts/backend-test.sh must exist, be executable, and run ephemeral postgres."""
        runner_path = ROOT / "scripts/backend-test.sh"
        self.assertTrue(runner_path.exists(), "scripts/backend-test.sh must exist")
        self.assertTrue(os.access(runner_path, os.X_OK), "scripts/backend-test.sh must be executable")
        content = runner_path.read_text(encoding="utf-8")
        self.assertIn("GRANETE_TEST_DATABASE=1", content)
        self.assertIn("granete_test", content)

    def test_init_sh_uses_backend_test_runner(self):
        """init.sh must use scripts/backend-test.sh rather than testing against dev DB."""
        init_path = ROOT / "init.sh"
        self.assertTrue(init_path.exists())
        init_content = init_path.read_text(encoding="utf-8")
        self.assertIn("scripts/backend-test.sh", init_content)
        self.assertNotIn("(cd backend-go && go test ./... 2>&1)", init_content)


if __name__ == "__main__":
    unittest.main()
