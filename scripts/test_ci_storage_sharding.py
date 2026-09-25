"""Static and behavior checks for the storage-sharded Go CI topology."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


PLAN = load_module("verify_storage_shard_plan", ROOT / "scripts/verify_storage_shard_plan.py")
AGGREGATE = load_module("ci_backend_go_result", ROOT / "scripts/ci_backend_go_result.py")


class StorageShardPlanTest(unittest.TestCase):
    def test_accepts_exact_four_way_partition(self):
        PLAN.verify(["TestA", "TestB", "TestC", "TestD"], [["TestA"], ["TestB"], ["TestC"], ["TestD"]], 4)

    def test_rejects_duplicate_and_missing_root(self):
        with self.assertRaisesRegex(ValueError, "invalid shard coverage"):
            PLAN.verify(["TestA", "TestB", "TestC", "TestD"], [["TestA"], ["TestA"], ["TestC"], ["TestD"]], 4)

    def test_rejects_empty_shard(self):
        with self.assertRaisesRegex(ValueError, "zero tests"):
            PLAN.verify(["TestA", "TestB", "TestC", "TestD"], [["TestA"], [], ["TestC"], ["TestD"]], 4)


class BackendAggregateTest(unittest.TestCase):
    def needs(self, selected=True, result="success"):
        return {
            "impact": {"result": "success", "outputs": {"plan": json.dumps({
                "schema": 1,
                "jobs": {
                    "typescript": False, "backend-go": selected, "sketchup-extension": False,
                    "proyectar-visual": False, "foundation-postgres": False, "organization-browser": False,
                },
            })}},
            "storage-shard-plan": {"result": result},
            "storage-shards": {"result": result},
            "backend-go-other": {"result": result},
        }

    def test_requires_all_split_backend_proofs_when_selected(self):
        self.assertTrue(AGGREGATE.validate_results(self.needs()))
        broken = self.needs()
        broken["storage-shards"]["result"] = "failure"
        with self.assertRaisesRegex(ValueError, "storage-shards"):
            AGGREGATE.validate_results(broken)

    def test_accepts_skipped_split_proofs_only_when_backend_unselected(self):
        self.assertFalse(AGGREGATE.validate_results(self.needs(selected=False, result="skipped")))


class WorkflowTopologyTest(unittest.TestCase):
    def test_workflow_uses_isolated_runner_and_no_storage_monolith(self):
        text = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        for fragment in (
            "storage-shard-plan:", "storage-shards:", "backend-go-other:", "backend-go:",
            "shard: [1, 2, 3]", "scripts/backend-test-storage-shard.sh 3",
            "verify_storage_shard_plan.py", "ci_backend_go_result.py",
            "grep -Fvx 'github.com/tiagofur/muebles-backend/internal/storage'",
        ):
            self.assertIn(fragment, text)
        self.assertNotIn("DATABASE_URL: postgres://postgres", text)
        self.assertNotIn("services:\n      postgres:", text)
        self.assertNotIn("go test -p 1 -timeout=30m -v ./...", text)

    def test_committed_before_timings_are_parseable_top_level_hints(self):
        timings = ROOT / "backend-go/testdata/storage-before-81a7896.timings"
        roots = [line for line in timings.read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(len(roots), 509)
        self.assertTrue(all(line.startswith("--- PASS: Test") and "/" not in line.split(" ")[2] for line in roots))


if __name__ == "__main__":
    unittest.main()
