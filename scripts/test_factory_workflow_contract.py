"""Static G-ODD instruction-drift guards, not execution or product evidence."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "docs/demo/software-factory-human-start.md"


class WorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = CONTRACT_PATH.read_text()
        cls.agents = (ROOT / "AGENTS.md").read_text()
        cls.task_convention = (ROOT / "odd/tasks/README.md").read_text()

    def test_roles_load_the_portable_contract(self):
        for role in ("leader", "implementer", "reviewer"):
            path = ROOT / ".agents" / "skills" / role / "SKILL.md"
            text = path.read_text()
            with self.subTest(role=role):
                self.assertIn("../../../docs/demo/software-factory-human-start.md", text)
                self.assertIn('description: "Trigger:', text)

    def test_contract_defines_one_factory_and_three_lanes(self):
        for phrase in (
            "One contract, two adapters",
            "Gentle-present",
            "Gentle-absent",
            "Direct",
            "ODD",
            "Explicit SDD",
            "Exactly one `odd/tasks/<issue>-<slug>.md`",
            "never a duplicate ODD task file",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.contract)

        self.assertIn("No durable execution artifact", self.task_convention)
        self.assertIn("Exactly one", self.task_convention)
        self.assertIn("canonical SDD tasks artifact", self.task_convention)

    def test_execution_and_review_boundaries_are_pinned(self):
        for phrase in (
            "One issue has one active writer",
            "different fresh actor",
            "One-shot means",
            "at most one consolidated correction round",
            "not a dogma",
            "CI validates the frozen candidate; it is not the debugger",
            "exact HEAD/base",
            "BLOCKED_OWNERSHIP_OR_POLICY",
            "PR_READY_FOR_HUMAN_MERGE",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.contract)

    def test_verification_and_truth_authority_are_explicit(self):
        for phrase in (
            "Sources of truth by concern",
            "V0 — Structural",
            "V1 — Functional",
            "V2 — Operational",
            "PREFLIGHT_OK_NOT_VERIFIED",
            "conservative selector",
            "NOT_RUN",
            "Engram is an optional retrieval accelerator and mirror",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.contract)

    def test_publication_and_human_merge_boundaries_are_preserved(self):
        for phrase in (
            "Delivery: complete",
            "Delivery: partial",
            "status:approved",
            "exactly one supported",
            "`type:*` label",
            "issue-reconcile.yml",
            "Never auto-approve, close by API, force-push, bypass, or merge",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.contract)

        template = (ROOT / ".github/PULL_REQUEST_TEMPLATE.md").read_text()
        self.assertTrue(template.startswith("Closes #<issue-number>\nDelivery: complete\n"))
        self.assertIn("complete => Closes/Fixes/Resolves #N", template)
        self.assertIn("partial => Refs #N", template)

    def test_legacy_catalog_is_not_operational_authority(self):
        catalog = json.loads((ROOT / "feature_list.json").read_text())
        self.assertTrue(catalog["rules"]["catalog_only"])
        self.assertNotIn("one_feature_at_a_time", catalog["rules"])
        for authority in (
            "queue",
            "scheduler",
            "priority",
            "ownership",
            "reservation",
            "execution_state",
        ):
            self.assertIn(authority, catalog["rules"]["not_operational_authority"])

    def test_progress_is_outside_the_normal_loop(self):
        progress = (ROOT / "progress/current.md").read_text()
        writer = (ROOT / ".agents/skills/implementer/SKILL.md").read_text()
        init = (ROOT / "init.sh").read_text()
        self.assertIn("outside the normal G-ODD execution loop", progress)
        self.assertIn("Do not use `feature_list.json` to choose work", writer)
        self.assertNotIn('"progress/current.md"', init)
        self.assertNotIn("len(in_progress)", init)

    def test_navigation_map_matches_portable_contract(self):
        for phrase in (
            "Portable G-ODD execution",
            "runtime-independent contract",
            "Exactly one `odd/tasks/<issue>-<slug>.md`",
            "use `progress/current.md` as startup context",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.agents)


if __name__ == "__main__":
    unittest.main()
