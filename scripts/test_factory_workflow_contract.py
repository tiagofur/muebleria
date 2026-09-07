"""Static instruction-drift guards, not dispatch or product-canary evidence."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "docs/demo/software-factory-human-start.md"


class WorkflowContractTest(unittest.TestCase):
    def test_roles_load_canonical_contract(self):
        for role in ("leader", "implementer", "reviewer"):
            path = ROOT / ".agents" / "skills" / role / "SKILL.md"
            text = path.read_text()
            self.assertIn("../../../" + CONTRACT, text)
            self.assertIn('description: "Trigger:', text)

    def test_legacy_unbounded_routing_removed(self):
        leader = (ROOT / ".agents/skills/leader/SKILL.md").read_text()
        writer = (ROOT / ".agents/skills/implementer/SKILL.md").read_text()
        self.assertNotIn("2-3 explorers", leader)
        self.assertNotIn("vuelve al paso 5", writer)
        self.assertNotIn("cambia estado a `done`", writer)
        self.assertIn("él asigna el revisor independiente", writer)

    def test_approval_budget_ownership_and_delivery_boundaries(self):
        contract = (ROOT / CONTRACT).read_text()
        for boundary in (
            "WAITING_FOR_SCOPE_APPROVAL", "60 minutos", "30 minutos",
            "10 minutos", "Máximo 1 ronda y 1 revalidación",
            "BLOCKED_BUDGET", "BLOCKED_OWNERSHIP_OR_POLICY",
            "implementer.enabled=false", "WAITING_FOR_HUMAN_MERGE",
            "PR_READY_FOR_HUMAN_MERGE", "no conjunto vacío",
            "mergeability unknown bloquea", "no autonomía",
        ):
            with self.subTest(boundary=boundary):
                self.assertIn(boundary, contract)


if __name__ == "__main__":
    unittest.main()
