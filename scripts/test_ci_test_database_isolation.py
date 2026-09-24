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
import subprocess
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

    def test_backend_test_runner_rejects_insecure_concurrency_flags(self):
        """scripts/backend-test.sh must reject -p > 1 or -parallel > 1 before running tests."""
        runner_path = ROOT / "scripts/backend-test.sh"
        # Test -p 4
        res_p = subprocess.run(
            [str(runner_path), "-p", "4", "./..."],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(res_p.returncode, 0)
        self.assertIn("insecure package concurrency", res_p.stderr)

        # Test -parallel 8
        res_par = subprocess.run(
            [str(runner_path), "-parallel", "8", "./..."],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(res_par.returncode, 0)
        self.assertIn("insecure test process concurrency", res_par.stderr)

    def test_init_sh_uses_backend_test_runner(self):
        """init.sh must use scripts/backend-test.sh rather than testing against dev DB."""
        init_path = ROOT / "init.sh"
        self.assertTrue(init_path.exists())
        init_content = init_path.read_text(encoding="utf-8")
        self.assertIn("scripts/backend-test.sh", init_content)
        self.assertNotIn("(cd backend-go && go test ./... 2>&1)", init_content)


    def test_go_tests_guard_database_url(self):
        """Go integration test files that read DATABASE_URL must invoke ValidateTestDatabaseURL or ValidateTestAdminDatabaseURL."""
        violations = find_unguarded_database_url_in_go(ROOT)
        self.assertEqual(
            violations,
            [],
            "Found Go test file reading DATABASE_URL without invoking ValidateTestDatabaseURL or ValidateTestAdminDatabaseURL:\n"
            + "\n".join(violations),
        )

    def test_anti_regression_scanner_logic(self):
        """Verify the scanner detects unguarded DATABASE_URL and permits guarded ones."""
        # 1. Insecure snippet (reads DATABASE_URL and creates pool without guard)
        insecure_content = """package foo_test
import (
    "os"
    "testing"
    "github.com/jackc/pgx/v5/pgxpool"
)
func TestInsecure(t *testing.T) {
    url := os.Getenv("DATABASE_URL")
    pool, _ := pgxpool.New(ctx, url)
}
"""
        violations = check_go_content_for_unguarded_db_url("foo_test.go", insecure_content)
        self.assertTrue(len(violations) > 0, "scanner must detect unguarded DATABASE_URL")

        # 2. Secure snippet (reads DATABASE_URL and invokes ValidateTestDatabaseURL)
        secure_content = """package foo_test
import (
    "os"
    "testing"
    "github.com/tiagofur/muebles-backend/internal/storage"
    "github.com/jackc/pgx/v5/pgxpool"
)
func TestSecure(t *testing.T) {
    url := os.Getenv("DATABASE_URL")
    if err := storage.ValidateTestDatabaseURL(url); err != nil {
        t.Fatal(err)
    }
    pool, _ := pgxpool.New(ctx, url)
}
"""
        violations_secure = check_go_content_for_unguarded_db_url("foo_test.go", secure_content)
        self.assertEqual(violations_secure, [], "scanner must permit guarded DATABASE_URL")

        # 3. Secure admin snippet (invokes ValidateTestAdminDatabaseURL)
        admin_content = """package foo_test
import (
    "os"
    "testing"
    "github.com/tiagofur/muebles-backend/internal/storage"
)
func TestAdmin(t *testing.T) {
    url := os.Getenv("DATABASE_URL")
    if err := storage.ValidateTestAdminDatabaseURL(url); err != nil {
        t.Fatal(err)
    }
}
"""
        violations_admin = check_go_content_for_unguarded_db_url("foo_test.go", admin_content)
        self.assertEqual(violations_admin, [], "scanner must permit ValidateTestAdminDatabaseURL")

        # 4. Mixed file: contains safe function AND unsafe function => MUST FAIL (BLOCKER 2)
        mixed_content = """package foo_test
import (
    "os"
    "testing"
    "github.com/tiagofur/muebles-backend/internal/storage"
    "github.com/jackc/pgx/v5/pgxpool"
)
func TestSafe(t *testing.T) {
    u := os.Getenv("DATABASE_URL")
    if err := storage.ValidateTestDatabaseURL(u); err != nil {
        t.Fatal(err)
    }
}
func TestUnsafe(t *testing.T) {
    u := os.Getenv("DATABASE_URL")
    pool, _ := pgxpool.New(ctx, u)
}
"""
        violations_mixed = check_go_content_for_unguarded_db_url("foo_test.go", mixed_content)
        self.assertTrue(len(violations_mixed) > 0, "scanner must detect unsafe function even if file has safe function")

        # 5. Top-level variable reading DATABASE_URL before first, between functions, and after last => MUST FAIL
        # 5a. Before first function
        toplevel_before_content = """package foo_test
import (
    "os"
    "testing"
)
var unsafeDSN = os.Getenv("DATABASE_URL")

func TestFoo(t *testing.T) {
    _ = unsafeDSN
}
"""
        violations_before = check_go_content_for_unguarded_db_url("foo_test.go", toplevel_before_content)
        self.assertTrue(len(violations_before) > 0, "scanner must detect top-level var before first function")

        # 5b. Between functions (the exact case reported in review 4)
        toplevel_between_content = """package foo_test
import (
    "os"
    "testing"
    "github.com/tiagofur/muebles-backend/internal/storage"
    "github.com/jackc/pgx/v5/pgxpool"
)
func TestSafe(t *testing.T) {
    u := os.Getenv("DATABASE_URL")
    if err := storage.ValidateTestDatabaseURL(u); err != nil {
        t.Fatal(err)
    }
}

var unsafeDSN = os.Getenv("DATABASE_URL")

func TestUnsafe(t *testing.T) {
    pool, _ := pgxpool.New(ctx, unsafeDSN)
}
"""
        violations_between = check_go_content_for_unguarded_db_url("foo_test.go", toplevel_between_content)
        self.assertTrue(len(violations_between) > 0, "scanner must detect top-level var between functions even when previous function is guarded")

        # 5c. After last function
        toplevel_after_content = """package foo_test
import (
    "os"
    "testing"
    "github.com/tiagofur/muebles-backend/internal/storage"
)
func TestSafe(t *testing.T) {
    u := os.Getenv("DATABASE_URL")
    if err := storage.ValidateTestDatabaseURL(u); err != nil {
        t.Fatal(err)
    }
}

var residualDSN = os.Getenv("DATABASE_URL")
"""
        violations_after = check_go_content_for_unguarded_db_url("foo_test.go", toplevel_after_content)
        self.assertTrue(len(violations_after) > 0, "scanner must detect top-level var after last function")

        # 6. testdb_guard_test.go itself does not trigger false positives
        guard_test_path = ROOT / "backend-go/internal/storage/testdb_guard_test.go"
        if guard_test_path.exists():
            violations_guard = check_go_content_for_unguarded_db_url(
                guard_test_path.relative_to(ROOT).as_posix(),
                guard_test_path.read_text(encoding="utf-8")
            )
            self.assertEqual(violations_guard, [], "testdb_guard_test.go must not be flagged")


def find_function_spans(content: str) -> list[tuple[str, int, int]]:
    """Return a list of (func_name, start_char_idx, end_char_idx) for top-level Go functions."""
    func_sig_pattern = re.compile(r'^[ \t]*func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\([^)]*\)[^{]*\{', re.MULTILINE)
    spans = []
    for match in func_sig_pattern.finditer(content):
        func_name = match.group(1)
        open_brace_idx = match.end() - 1
        # Find matching closing brace
        depth = 0
        in_string = False
        in_raw_string = False
        in_line_comment = False
        in_block_comment = False
        i = open_brace_idx
        end_idx = -1

        while i < len(content):
            c = content[i]
            # Handle comments and strings
            if in_line_comment:
                if c == '\n':
                    in_line_comment = False
            elif in_block_comment:
                if c == '*' and i + 1 < len(content) and content[i + 1] == '/':
                    in_block_comment = False
                    i += 1
            elif in_raw_string:
                if c == '`':
                    in_raw_string = False
            elif in_string:
                if c == '\\':
                    i += 1  # Skip escaped char
                elif c == '"':
                    in_string = False
            else:
                if c == '/' and i + 1 < len(content):
                    if content[i + 1] == '/':
                        in_line_comment = True
                        i += 1
                    elif content[i + 1] == '*':
                        in_block_comment = True
                        i += 1
                elif c == '"':
                    in_string = True
                elif c == '`':
                    in_raw_string = True
                elif c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        end_idx = i + 1
                        break
            i += 1

        if end_idx != -1:
            spans.append((func_name, match.start(), end_idx))
    return spans


def check_go_content_for_unguarded_db_url(rel_path: str, content: str) -> list[str]:
    # Exclude files that define the guards or test their negative rejections
    if rel_path in (
        "backend-go/internal/storage/testdb_guard.go",
        "backend-go/internal/storage/testdb_guard_test.go",
    ):
        return []

    # Any access to DATABASE_URL outside of a function (e.g. global/top-level var before,
    # between, or after functions) is strictly forbidden.
    # Furthermore, any function reading os.Getenv("DATABASE_URL") MUST invoke ValidateTestDatabaseURL,
    # ValidateTestAdminDatabaseURL, TestDatabaseURL, or TestAdminDatabaseURL within that same function.
    violations = []

    # Find exact function spans using brace balancing
    spans = find_function_spans(content)

    # Find all occurrences of os.Getenv("DATABASE_URL") or os.Getenv('DATABASE_URL')
    db_url_pattern = re.compile(r'os\.Getenv\(\s*["\']DATABASE_URL["\']\s*\)')

    for match in db_url_pattern.finditer(content):
        match_start = match.start()
        line_no = content[:match_start].count("\n") + 1

        # Check if match_start is inside any function span
        enclosing_func = None
        for func_name, f_start, f_end in spans:
            if f_start <= match_start < f_end:
                enclosing_func = (func_name, f_start, f_end)
                break

        if enclosing_func is None:
            violations.append(
                f"{rel_path}:{line_no}: top-level code reads os.Getenv(\"DATABASE_URL\") outside of function"
            )
        else:
            func_name, f_start, f_end = enclosing_func
            func_body = content[f_start:f_end]
            has_guard_in_func = (
                "ValidateTestDatabaseURL" in func_body
                or "ValidateTestAdminDatabaseURL" in func_body
                or "TestDatabaseURL" in func_body
                or "TestAdminDatabaseURL" in func_body
            )
            if not has_guard_in_func:
                violations.append(
                    f"{rel_path}:{line_no}: function {func_name} reads os.Getenv(\"DATABASE_URL\") without calling ValidateTestDatabaseURL or ValidateTestAdminDatabaseURL"
                )

    return violations


def find_unguarded_database_url_in_go(root: Path) -> list[str]:
    violations = []
    for p in (root / "backend-go").rglob("*_test.go"):
        parts = p.parts
        if ".git" in parts or "vendor" in parts:
            continue
        rel = p.relative_to(root).as_posix()
        content = p.read_text(encoding="utf-8", errors="replace")
        violations.extend(check_go_content_for_unguarded_db_url(rel, content))
    return violations


if __name__ == "__main__":
    unittest.main()

