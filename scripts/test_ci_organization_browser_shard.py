"""Unit proofs for the organization browser shard planner (fail-closed)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from organization_browser_shard import (  # noqa: E402
    compute_shards,
    load_timings,
    spec_files,
    verify_partition,
)


def write_timings(directory: Path, default: float, files: dict[str, float]) -> Path:
    path = directory / "timings.json"
    path.write_text(json.dumps({"schema": 1, "default_seconds": default, "files": files}), encoding="utf-8")
    return path


class ComputeShardsTest(unittest.TestCase):
    def test_partition_is_exact_and_deterministic(self):
        files = [f"tests/organization/f{i:02}.spec.ts" for i in range(10)]
        first = compute_shards(files, 20.0, {}, 3)
        second = compute_shards(files, 20.0, {}, 3)
        self.assertEqual(first, second)
        verify_partition(files, first)
        self.assertEqual(sorted(name for shard in first for name in shard), sorted(files))

    def test_lpt_balances_known_weights(self):
        files = [f"tests/organization/f{i}.spec.ts" for i in range(6)]
        weights = {files[0]: 100.0, files[1]: 90.0, files[2]: 80.0,
                   files[3]: 70.0, files[4]: 60.0, files[5]: 50.0}
        shards = compute_shards(files, 20.0, weights, 3)
        loads = sorted(sum(weights[name] for name in shard) for shard in shards)
        # Pairing heaviest with lightest is the optimal 450/3 split here.
        self.assertEqual(loads, [150.0, 150.0, 150.0])

    def test_unknown_files_take_conservative_default(self):
        files = ["tests/organization/new.spec.ts", "tests/organization/known.spec.ts"]
        shards = compute_shards(files, 30.0, {"tests/organization/known.spec.ts": 10.0}, 2)
        verify_partition(files, shards)
        self.assertIn("tests/organization/new.spec.ts", shards[0] + shards[1])

    def test_more_shards_than_files_keeps_partition_valid(self):
        files = ["tests/organization/a.spec.ts"]
        shards = compute_shards(files, 10.0, {}, 3)
        verify_partition(files, shards)
        self.assertEqual([["tests/organization/a.spec.ts"]], [s for s in shards if s])

    def test_invalid_shard_count_rejected(self):
        with self.assertRaises(ValueError):
            compute_shards(["a"], 10.0, {}, 0)


class VerifyPartitionTest(unittest.TestCase):
    def test_duplicate_assignment_fails_closed(self):
        files = ["a.spec.ts", "b.spec.ts"]
        with self.assertRaises(ValueError):
            verify_partition(files, [["a.spec.ts"], ["a.spec.ts"]])

    def test_missing_file_fails_closed(self):
        with self.assertRaises(ValueError):
            verify_partition(["a.spec.ts", "b.spec.ts"], [["a.spec.ts"], []])

    def test_unknown_file_fails_closed(self):
        with self.assertRaises(ValueError):
            verify_partition(["a.spec.ts"], [["a.spec.ts"], ["ghost.spec.ts"]])


class TimingsBaselineTest(unittest.TestCase):
    def test_repository_baseline_is_valid_and_covers_current_specs(self):
        root = Path(__file__).resolve().parents[1]
        default, weights = load_timings(root / "tests/organization/testdata/browser-shard-timings.json")
        self.assertGreater(default, 0)
        current = spec_files(root)
        shards = compute_shards(current, default, weights, 3)
        verify_partition(current, shards)
        for shard in shards:
            self.assertTrue(shard, "every shard must carry at least one spec file")

    def test_baseline_rejects_bad_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "timings.json"
            path.write_text(json.dumps({"schema": 99, "default_seconds": 1, "files": {}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_timings(path)

    def test_new_spec_file_without_timing_still_partitions(self):
        root = Path(__file__).resolve().parents[1]
        default, weights = load_timings(root / "tests/organization/testdata/browser-shard-timings.json")
        grown = spec_files(root) + ["tests/organization/zz-future.spec.ts"]
        shards = compute_shards(grown, default, weights, 3)
        verify_partition(grown, shards)


if __name__ == "__main__":
    unittest.main()
