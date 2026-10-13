import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_extension_version as guard

IDENTITY = guard.IDENTITY
RUNTIME = "apps/sketchup-extension/src/granete_for_sketchup/application.rb"


def identity(version):
    return f"module X\n  EXTENSION_VERSION = '{version}' unless const_defined?(:EXTENSION_VERSION, false)\nend\n"


class Repo:
    def __init__(self, root):
        self.root = Path(root)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.test")
        self.git("config", "user.name", "t")
        self.git("config", "commit.gpgsign", "false")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], text=True).strip()

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def commit(self, message="c"):
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")


class GuardTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Repo(self._tmp.name)
        self.repo.write(IDENTITY, identity("0.1.71"))
        self.repo.write(RUNTIME, "a = 1\n")
        self.repo.write("apps/sketchup-extension/test/unit/x_test.rb", "t\n")
        self.repo.write("docs/readme.md", "d\n")
        self.base = self.repo.commit("base")

    def run_check(self, head):
        return guard.check(self.repo.root, self.base, head)

    def assertFails(self, head, fragment=""):
        with self.assertRaises(guard.GuardError) as caught:
            self.run_check(head)
        self.assertIn(fragment, str(caught.exception))

    def test_runtime_change_without_bump_fails_and_names_files(self):
        self.repo.write(RUNTIME, "a = 2\n")
        self.assertFails(self.repo.commit(), RUNTIME)

    def test_runtime_change_with_bump_passes(self):
        self.repo.write(RUNTIME, "a = 2\n")
        self.repo.write(IDENTITY, identity("0.1.72"))
        self.assertIn("0.1.71 -> 0.1.72", self.run_check(self.repo.commit()))

    def test_non_packaged_changes_do_not_require_bump(self):
        self.repo.write("apps/sketchup-extension/test/unit/x_test.rb", "changed\n")
        self.repo.write("apps/sketchup-extension/README.md", "doc\n")
        self.repo.write("docs/readme.md", "changed\n")
        self.assertIn("no packaged", self.run_check(self.repo.commit()))

    def test_version_only_edit_is_allowed(self):
        self.repo.write(IDENTITY, identity("0.1.72"))
        self.assertIn("no packaged", self.run_check(self.repo.commit()))

    def test_other_identity_edit_without_bump_fails(self):
        self.repo.write(IDENTITY, identity("0.1.71") + "# new constant\n")
        self.assertFails(self.repo.commit(), IDENTITY)

    def test_added_and_deleted_runtime_files_require_bump(self):
        added = "apps/sketchup-extension/src/granete_for_sketchup/resources/js/new.js"
        self.repo.write(added, "x\n")
        self.assertFails(self.repo.commit(), added)
        self.repo.git("reset", "-q", "--hard", self.base)
        self.repo.git("rm", "-q", RUNTIME)
        self.assertFails(self.repo.commit(), RUNTIME)

    def test_rename_counts_as_delete_plus_add(self):
        self.repo.git("mv", RUNTIME, RUNTIME.replace("application", "renamed"))
        self.assertFails(self.repo.commit(), "2 packaged")

    def test_comment_only_runtime_change_still_requires_bump(self):
        self.repo.write(RUNTIME, "a = 1 # note\n")
        self.assertFails(self.repo.commit())

    def test_change_then_revert_is_not_a_change(self):
        self.repo.write(RUNTIME, "a = 2\n")
        self.repo.commit()
        self.repo.write(RUNTIME, "a = 1\n")
        self.assertIn("no packaged", self.run_check(self.repo.commit()))

    def test_version_comparison_is_numeric_not_lexical(self):
        self.repo.write(IDENTITY, identity("0.1.9"))
        base = self.repo.commit()
        self.repo.write(RUNTIME, "a = 2\n")
        self.repo.write(IDENTITY, identity("0.1.10"))
        head = self.repo.commit()
        self.assertIn("0.1.9 -> 0.1.10", guard.check(self.repo.root, base, head))
        self.assertRaises(guard.GuardError, guard.check, self.repo.root, head, base)

    def test_version_downgrade_fails_even_without_content_change(self):
        self.repo.write(IDENTITY, identity("0.1.70"))
        self.assertFails(self.repo.commit(), "backwards")

    def test_malformed_or_missing_version_fails_closed(self):
        for text in (identity("0.1"), identity("v0.1.72"), identity("0.1.72") + identity("0.1.73"), "module X; end\n"):
            with self.subTest(text=text):
                self.repo.git("reset", "-q", "--hard", self.base)
                self.repo.write(IDENTITY, text)
                self.repo.write(RUNTIME, "a = 2\n")
                self.assertRaises(guard.GuardError, self.run_check, self.repo.commit())

    def test_missing_identity_file_fails_closed(self):
        self.repo.git("rm", "-q", IDENTITY)
        self.assertRaises(guard.GuardError, self.run_check, self.repo.commit())

    def test_unknown_ref_fails_closed(self):
        self.assertRaises(guard.GuardError, guard.check, self.repo.root, self.base, "nope")


class CiContextTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Repo(self._tmp.name)
        self.repo.write(IDENTITY, identity("0.1.71"))
        self.repo.write(RUNTIME, "a = 1\n")
        self.repo.write("docs/readme.md", "d\n")
        self.fork = self.repo.commit("fork point")

    def merge(self, pr_files, main_files=None):
        """Real merge commit like GitHub's refs/pull/N/merge: first parent is target tip."""
        self.repo.git("switch", "-q", "-c", "pr")
        for path, text in pr_files.items():
            self.repo.write(path, text)
        self.repo.commit("pr")
        self.repo.git("switch", "-q", "main")
        for path, text in (main_files or {"docs/readme.md": "later\n"}).items():
            self.repo.write(path, text)
        base = self.repo.commit("main moved")
        self.repo.git("merge", "-q", "--no-ff", "-m", "merge", "pr")
        return base, self.repo.git("rev-parse", "HEAD")

    def refs(self, tested, event_name="pull_request", event=None):
        return guard.ci_refs(self.repo.root, event_name, event or {}, tested)

    def test_pr_without_bump_fails_against_moved_base(self):
        base, tested = self.merge({RUNTIME: "a = 2\n"})
        self.assertEqual(self.refs(tested), (base, tested))
        self.assertRaises(guard.GuardError, guard.check, self.repo.root, *self.refs(tested))

    def test_pr_with_bump_passes(self):
        _, tested = self.merge({RUNTIME: "a = 2\n", IDENTITY: identity("0.1.72")})
        self.assertIn("PASS", guard.check(self.repo.root, *self.refs(tested)))

    def test_docs_only_pr_passes_when_main_moved_runtime(self):
        # The base moved a packaged file + bump; the PR itself is docs-only.
        _, tested = self.merge({"docs/readme.md": "pr\n"},
                               {RUNTIME: "a = 3\n", IDENTITY: identity("0.1.72")})
        self.assertIn("no packaged", guard.check(self.repo.root, *self.refs(tested)))

    def test_same_bump_as_another_merged_pr_is_a_collision(self):
        # PR bumped to 0.1.72 but main already shipped 0.1.72: merged tree must fail.
        _, tested = self.merge({RUNTIME: "a = 2\n", IDENTITY: identity("0.1.72")},
                               {IDENTITY: identity("0.1.72"), "docs/readme.md": "x\n"})
        self.assertRaises(guard.GuardError, guard.check, self.repo.root, *self.refs(tested))

    def test_non_merge_commit_in_pull_request_fails_closed(self):
        self.assertRaises(guard.GuardError, self.refs, self.fork)

    def test_checkout_mismatch_fails_closed(self):
        _, tested = self.merge({RUNTIME: "a = 2\n"})
        self.assertRaises(guard.GuardError, self.refs, self.fork)
        self.assertRaises(guard.GuardError, self.refs, "")
        self.assertRaises(guard.GuardError, self.refs, "z" * 40)
        self.assertEqual(self.refs(tested)[1], tested)

    def test_merge_group_uses_event_base(self):
        self.repo.write(RUNTIME, "a = 2\n")
        tested = self.repo.commit()
        event = {"merge_group": {"base_sha": self.fork}}
        self.assertEqual(self.refs(tested, "merge_group", event), (self.fork, tested))
        self.assertRaises(guard.GuardError, self.refs, tested, "merge_group", {})
        self.assertRaises(guard.GuardError, self.refs, tested, "merge_group", {"merge_group": {"base_sha": "bad"}})

    def test_push_and_dispatch_are_skipped_not_passed(self):
        for name in ("push", "workflow_dispatch", ""):
            self.assertIsNone(self.refs(self.fork, name))

    def test_cli_ci_mode_fails_with_message_and_exit_code(self):
        _, tested = self.merge({RUNTIME: "a = 2\n"})
        event = Path(self._tmp.name) / "event.json"
        event.write_text(json.dumps({}), encoding="utf-8")
        env = {**os.environ, "GITHUB_EVENT_NAME": "pull_request", "GITHUB_EVENT_PATH": str(event), "GITHUB_SHA": tested}
        script = Path(guard.__file__)
        # Run the real entrypoint against the temp repository.
        code = (
            "import sys; sys.path.insert(0, %r); import ci_extension_version as g; "
            "from pathlib import Path; g.ROOT = Path(%r); sys.exit(g.main())" % (str(script.parent), self._tmp.name)
        )
        done = subprocess.run([os.sys.executable, "-c", code, "--ci"], env=env, capture_output=True, text=True)
        self.assertEqual(done.returncode, 1)
        self.assertIn("FAIL", done.stderr)
        self.assertIn("EXTENSION_VERSION", done.stderr)


if __name__ == "__main__":
    unittest.main()
