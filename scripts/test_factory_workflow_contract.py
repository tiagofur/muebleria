"""Static G-ODD instruction-drift guards, not execution or product evidence."""
from copy import deepcopy
import json
from pathlib import Path
import re
import unittest

from validate_feature_catalog import (
    CatalogError,
    FEATURE_KEYS,
    OPERATIONAL_KEYS,
    OPERATIONAL_TITLE,
    TOP_LEVEL_KEYS,
    validate_data,
)


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "docs/demo/software-factory-human-start.md"
LIVE_FACTORY_PATHS = (
    ".agents/skills/implementer/SKILL.md",
    ".agents/skills/reviewer/SKILL.md",
    "AGENTS.md",
    "CHECKPOINTS.md",
    "README.md",
    "init.sh",
    "docs/verification.md",
    "docs/git-workflow.md",
    "docs/architecture/hardware-3d-assets-and-assemblies.md",
    "docs/hardware-3d-execution-plan.md",
    "docs/demo/software-factory-agent-reference.md",
    "docs/demo/software-factory-human-start.md",
    "docs/demo/software-factory-status.md",
    "backend-go/internal/api/furniture_layout.go",
    "backend-go/internal/domain/engine/layout.go",
)
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

    def test_global_current_file_and_live_references_are_absent(self):
        self.assertFalse((ROOT / "progress/current.md").exists())
        for relative in LIVE_FACTORY_PATHS:
            text = (ROOT / relative).read_text()
            with self.subTest(path=relative):
                self.assertNotIn("progress/current.md", text)

    def test_completed_odd_artifacts_need_no_cleanup_or_global_scan(self):
        for phrase in (
            "remain in `odd/tasks/`",
            "immutable history",
            "never scan",
            "No post-merge cleanup",
            "Do not add front matter",
        ):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.task_convention)
        self.assertFalse((ROOT / "odd/archive").exists())
        for path in (ROOT / "odd/tasks").glob("*.md"):
            if path.name == "README.md":
                continue
            with self.subTest(path=path.name):
                self.assertRegex(path.name, r"^[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
                self.assertFalse(path.read_text().startswith("---\n"))

    def test_routine_preflight_does_not_read_global_catalog(self):
        preflight = (ROOT / "scripts/factory_preflight.py").read_text()
        self.assertNotIn("feature_list.json", preflight)

    def test_capability_catalog_has_only_stable_product_metadata(self):
        catalog = json.loads((ROOT / "feature_list.json").read_text())
        self.assertEqual(validate_data(catalog, ROOT), len(catalog["features"]))
        self.assertEqual(set(catalog), TOP_LEVEL_KEYS)
        self.assertEqual(catalog["schema_version"], 2)
        self.assertGreaterEqual(len(catalog["features"]), 5)
        self.assertLessEqual(len(catalog["features"]), 30)
        identifiers = []
        for feature in catalog["features"]:
            with self.subTest(feature=feature.get("id")):
                self.assertEqual(set(feature), FEATURE_KEYS)
                self.assertFalse(set(feature) & OPERATIONAL_KEYS)
                self.assertRegex(feature["id"], r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
                self.assertTrue(feature["title"].strip())
                self.assertTrue(feature["summary"].strip())
                self.assertIsNone(OPERATIONAL_TITLE.search(feature["title"]))
                self.assertIsInstance(feature["canonical_docs"], list)
                self.assertTrue(feature["canonical_docs"])
            identifiers.append(feature["id"])
        self.assertEqual(len(identifiers), len(set(identifiers)))

    def test_catalog_validator_rejects_operational_state_and_duplicate_ids(self):
        catalog = json.loads((ROOT / "feature_list.json").read_text())
        for field in ("status", "type", "category", "owner"):
            invalid = deepcopy(catalog)
            invalid["features"][0][field] = "pending"
            with self.subTest(field=field), self.assertRaisesRegex(
                CatalogError, "operational fields"
            ):
                validate_data(invalid, ROOT)

        duplicate = deepcopy(catalog)
        duplicate["features"][1]["id"] = duplicate["features"][0]["id"]
        with self.assertRaisesRegex(CatalogError, "duplicate feature id"):
            validate_data(duplicate, ROOT)

    def test_navigation_map_matches_portable_contract(self):
        for phrase in (
            "Portable G-ODD execution",
            "runtime-independent contract",
            "Exactly one `odd/tasks/<issue>-<slug>.md`",
            "global progress ledger",
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
                self.assertRegex(
                    normalized,
                    r"preflight[\s\S]{0,180}read-only|read-only[\s\S]{0,180}preflight",
                )
                self.assertRegex(
                    normalized, r"init\.sh[\s\S]{0,160}(explicit|only when)"
                )
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
        self.assertRegex(
            lowered, r"one (?:approved )?issue[^\n]{0,80}one (?:active )?writer"
        )
        catalog_lines = [
            line.lower()
            for line in self.agent_reference.splitlines()
            if "feature_list.json" in line
        ]
        self.assertTrue(any("catalog" in line for line in catalog_lines))
        self.assertTrue(any("never" in line or "not" in line for line in catalog_lines))


if __name__ == "__main__":
    unittest.main()
