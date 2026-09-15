"""Behavioral proof of conservative selection, including real Git diffs."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ci_impact as impact


class ClassificationTest(unittest.TestCase):
    def jobs(self, *paths):
        return impact.classify(paths)["jobs"]

    def test_plain_documentation_does_not_schedule_runtime_suites(self):
        self.assertFalse(any(self.jobs("docs/history/notes.md", "progress/example.md").values()))

    def test_no_paths_is_full_not_empty_proof(self):
        self.assertTrue(all(self.jobs().values()))

    def test_unknown_and_global_inputs_fail_safe(self):
        for path in ("new-language/main.rs", "README.mdx", "docs/fixture.json", "AGENTS.md",
                     "pnpm-lock.yaml", "package.json", "tsconfig.base.json",
                     "scripts/ci_impact.py", ".github/workflows/ci.yml",
                     "docs/deployment.md", "docs/verification.md",
                     "docs/demo/software-factory-human-start.md"):
            with self.subTest(path=path):
                self.assertTrue(all(self.jobs(path).values()))

    def test_react_keeps_real_browser_and_visual_but_not_unrelated_languages(self):
        jobs = self.jobs("packages/ui/src/components/HelpCard.tsx")
        self.assertEqual({key for key, on in jobs.items() if on},
                         {"typescript", "organization-browser", "proyectar-visual"})

    def test_mixed_changes_form_union(self):
        jobs = self.jobs("packages/ui/src/help.tsx", "apps/sketchup-extension/test/unit/widget_test.rb")
        self.assertTrue(jobs["typescript"] and jobs["sketchup-extension"])
        self.assertFalse(jobs["backend-go"])

    def test_plugin_only_preserves_platform_matrix(self):
        self.assertEqual({key for key, on in self.jobs("apps/sketchup-extension/src/tools/move.rb").items() if on},
                         {"sketchup-extension"})

    def test_sensitive_boundaries_always_select_every_proof(self):
        for path in ("packages/ui/src/projects/releaseContext.ts", "apps/web/src/stores/sessionStore.ts",
                     "apps/web/src/auth/Login.tsx", "packages/domain/src/bom.ts",
                     "packages/storage/src/client.ts", "backend-go/internal/domain/engine/a.go",
                     "contracts/roles.json", "apps/sketchup-extension/src/connection/transport.rb"):
            with self.subTest(path=path):
                self.assertTrue(all(self.jobs(path).values()))

    def test_invalid_path_cannot_hide_impact(self):
        for path in ("/etc/passwd", "../docs/readme.md", "docs/../config.md", "docs/evil\nname.md", ""):
            self.assertTrue(all(self.jobs(path).values()))

    def test_backend_requires_all_in_initial_conservative_map(self):
        self.assertTrue(all(self.jobs("backend-go/go.sum").values()))

    def test_web_and_ui_configs_are_not_narrow_source(self):
        for path in ("apps/web/package.json", "packages/ui/tsconfig.json", "apps/web/vite.config.ts"):
            self.assertTrue(all(self.jobs(path).values()))

    def test_ci_non_pr_event_is_full(self):
        for event in ("push", "workflow_dispatch", "merge_group", "unknown"):
            plan = impact.plan_for_ci(Path("."), event, {}, "a" * 40)
            self.assertTrue(all(plan["jobs"].values()))

    def test_ci_malformed_event_and_missing_base_are_full(self):
        for event in ({}, {"pull_request": {"base": {"sha": "bad"}}}):
            plan = impact.plan_for_ci(Path("."), "pull_request", event, "a" * 40)
            self.assertTrue(all(plan["jobs"].values()))


class GitDiffTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Test")
        self.write("packages/domain/src/bom.ts", "baseline")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], text=True)

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "change")
        return self.git("rev-parse", "HEAD").strip()

    def test_deleted_or_renamed_critical_file_cannot_become_docs_only(self):
        self.git("mv", "packages/domain/src/bom.ts", "moved.md")
        paths = impact.changed_paths(self.root, self.base, self.commit())
        self.assertIn("packages/domain/src/bom.ts", paths)
        self.assertTrue(all(impact.classify(paths)["jobs"].values()))

    def test_over_300_paths_are_not_truncated(self):
        for i in range(350):
            self.write(f"docs/change-{i}.md", "note")
        self.write("packages/domain/src/bom.ts", "changed")
        paths = impact.changed_paths(self.root, self.base, self.commit())
        self.assertEqual(len(paths), 351)
        self.assertTrue(all(impact.classify(paths)["jobs"].values()))

    def test_local_includes_staged_unstaged_and_untracked(self):
        self.write("docs/committed.md", "committed")
        head = self.commit()
        self.write("docs/staged.md", "staged")
        self.git("add", "docs/staged.md")
        self.write("packages/domain/src/bom.ts", "unstaged")
        self.write("apps/web/src/help.tsx", "untracked")
        paths = impact.changed_paths(self.root, self.base, head, include_worktree=True)
        for name in ("docs/committed.md", "docs/staged.md", "packages/domain/src/bom.ts", "apps/web/src/help.tsx"):
            self.assertIn(name, paths)

    def test_staged_change_hidden_by_worktree_reset_is_still_selected(self):
        self.write("packages/domain/src/bom.ts", "staged critical change")
        self.git("add", ".")
        self.write("packages/domain/src/bom.ts", "baseline")
        paths = impact.changed_paths(self.root, self.base, self.base, include_worktree=True)
        self.assertIn("packages/domain/src/bom.ts", paths)

    def test_local_new_file_near_diff_head_is_present(self):
        self.write("docs/new.md", "new")
        head = self.commit()
        self.assertEqual(impact.changed_paths(self.root, self.base, head), ["docs/new.md"])

    def test_invalid_revision_does_not_turn_into_docs_only(self):
        with self.assertRaises((ValueError, subprocess.CalledProcessError)):
            impact.changed_paths(self.root, "does-not-exist", "HEAD")

    def test_ci_head_mismatch_forces_full(self):
        self.write("docs/new.md", "new")
        head = self.commit()
        event = {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}
        self.assertTrue(all(impact.plan_for_ci(self.root, "pull_request", event, self.base)["jobs"].values()))

    def test_ci_direct_head_without_merge_coverage_forces_full(self):
        self.write("docs/new.md", "new")
        head = self.commit()
        event = {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}
        self.assertTrue(all(impact.plan_for_ci(self.root, "pull_request", event, head)["jobs"].values()))

    def test_ci_merged_tree_compared_to_exact_base(self):
        self.git("checkout", "-qb", "feature")
        self.write("docs/new.md", "new")
        head = self.commit()
        self.git("checkout", "--detach", self.base)
        self.git("merge", "--no-ff", "-qm", "merge", "feature")
        tested = self.git("rev-parse", "HEAD").strip()
        event = {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}
        plan = impact.plan_for_ci(self.root, "pull_request", event, tested)
        self.assertFalse(any(plan["jobs"].values()))
        self.assertEqual(plan["tested_sha"], tested)
        self.assertEqual(plan["head_sha"], head)


if __name__ == "__main__":
    unittest.main()
