"""Static G-ODD instruction-drift guards, not execution or product evidence."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "docs/demo/software-factory-human-start.md"


class WorkflowContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = CONTRACT_PATH.read_text()
        cls.agents = (ROOT / "AGENTS.md").read_text()
        cls.task_convention = (ROOT / "odd/tasks/README.md").read_text()
        cls.readme = (ROOT / "README.md").read_text()
        cls.agent_reference = (
            ROOT / "docs/demo/software-factory-agent-reference.md"
        ).read_text()
        cls.task_artifact = (
            ROOT / "odd/tasks/573-portable-g-odd-factory.md"
        ).read_text()

    @staticmethod
    def section(text, heading, next_heading):
        start = text.index(heading)
        end = text.find(next_heading, start + len(heading))
        return text[start:] if end == -1 else text[start:end]

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

    def test_routine_startup_is_read_only_preflight_in_live_entrypoints(self):
        sections = (
            self.section(self.readme, "## Cómo arrancar", "### Desktop"),
            self.section(
                self.agent_reference,
                "## 2. Antes de empezar",
                "### Si la issue toca",
            ),
        )
        for start in sections:
            normalized = start.lower()
            with self.subTest(section=start.splitlines()[0]):
                self.assertLess(
                    normalized.index("factory_preflight.py"),
                    normalized.index("init.sh"),
                )
                self.assertRegex(normalized, r"preflight[\s\S]{0,180}read-only|read-only[\s\S]{0,180}preflight")
                self.assertRegex(normalized, r"init\.sh[\s\S]{0,160}(explicit|only when)")
                self.assertNotRegex(
                    start,
                    r"```(?:bash|sh)?\s*\n\./init\.sh\s*\n```",
                )

    def test_live_reference_has_per_issue_writer_not_global_feature_governance(self):
        live_docs = "\n".join((self.agents, self.contract, self.agent_reference))
        lowered = live_docs.lower()
        forbidden = (
            r"una feature activa a la vez",
            r"one feature (?:active )?at a time",
            r"identifica la feature activa",
            r"ledger:\s*`feature_list\.json`",
        )
        for pattern in forbidden:
            with self.subTest(pattern=pattern):
                self.assertIsNone(re.search(pattern, lowered))
        self.assertRegex(lowered, r"one (?:approved )?issue[^\n]{0,80}one (?:active )?writer")
        catalog_lines = [
            line.lower()
            for line in self.agent_reference.splitlines()
            if "feature_list.json" in line
        ]
        self.assertTrue(any("catalog" in line or "histor" in line for line in catalog_lines))
        self.assertTrue(any("never" in line or "not" in line for line in catalog_lines))

    def test_execution_artifact_records_actual_candidate_and_remote_boundary(self):
        artifact = self.task_artifact.lower()
        self.assertIn("1,405 authored changed lines", artifact)
        self.assertIn("c1c05fe63e5092669ff0ef94c7722dfc73b3a397", artifact)
        self.assertRegex(artifact, r"writer[^\n]{0,100}(?:does not push|no remote mutation)")
        self.assertRegex(artifact, r"parent[^\n]{0,160}(?:publish|open the authorized pr)")
        next_step = self.section(self.task_artifact, "## Next step", "\n## ").lower()
        self.assertIn("fresh independent re-review", next_step)
        self.assertNotIn("create the godd-3 work-unit commit", next_step)

    def test_execution_artifact_has_completed_correction_boundary(self):
        artifact = self.task_artifact.lower()
        correction_sha = "afa766b7c0cd68de9098999158a9b2ec2d9593e1"
        self.assertRegex(
            artifact,
            correction_sha + r"[\s\S]{0,220}1,525 authored changed lines",
        )
        self.assertRegex(
            artifact,
            correction_sha + r"[\s\S]{0,520}dirty: false",
        )
        self.assertRegex(
            artifact,
            r"mechanical exception[\s\S]{0,240}cannot truthfully[\s\S]{0,240}(?:sha|post-commit)",
        )

        next_step = self.section(self.task_artifact, "## Next step", "\n## ").lower()
        self.assertIn("fresh independent re-review", next_step)
        self.assertIn("exception-ok", artifact)
        self.assertIn("publish one pr", next_step)
        if "exception-ok" in artifact:
            self.assertIsNone(
                re.search(r"\b(?:commit|committing|create a commit)\b", next_step),
                "An exception-ok decision must advance to review/publication, not a pending commit",
            )
        for pending_pattern in (
            r"complete (?:the )?(?:single )?correction commit",
            r"create (?:the )?correction commit",
            r"correction commit (?:is )?pending",
        ):
            with self.subTest(pattern=pending_pattern):
                self.assertIsNone(re.search(pending_pattern, next_step))


if __name__ == "__main__":
    unittest.main()
