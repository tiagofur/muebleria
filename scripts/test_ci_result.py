import copy
import json
import unittest

from ci_impact import JOBS, classify, full
from ci_result import validate_results

SHA = "a" * 40


def fixture(plan=None):
    plan = copy.deepcopy(plan or full("test"))
    plan["tested_sha"] = SHA
    needs = {"impact": {"result": "success", "outputs": {"plan": json.dumps(plan)}},
             "validate-catalog": {"result": "success"}}
    for job in JOBS:
        needs[job] = {"result": "success" if plan["jobs"][job] else "skipped"}
    return needs


class ResultTest(unittest.TestCase):
    def test_full_success(self):
        self.assertTrue(all(validate_results(fixture(), SHA)["jobs"].values()))

    def test_docs_only_is_not_an_empty_status_set(self):
        needs = fixture(classify(["docs/history/change.md"]))
        self.assertFalse(any(validate_results(needs, SHA)["jobs"].values()))
        with self.assertRaises(ValueError):
            validate_results({}, SHA)

    def test_every_required_suite_must_succeed(self):
        for job in JOBS:
            for outcome in ("failure", "cancelled", "skipped", "pending", None):
                with self.subTest(job=job, outcome=outcome):
                    needs = fixture()
                    needs[job]["result"] = outcome
                    with self.assertRaises(ValueError):
                        validate_results(needs, SHA)

    def test_failed_unselected_job_cannot_be_hidden(self):
        for outcome in ("failure", "cancelled", None):
            needs = fixture(classify(["docs/history/change.md"]))
            needs["backend-go"]["result"] = outcome
            with self.assertRaises(ValueError):
                validate_results(needs, SHA)

    def test_unselected_job_may_run_more_checks(self):
        needs = fixture(classify(["docs/history/change.md"]))
        needs["backend-go"]["result"] = "success"
        validate_results(needs, SHA)

    def test_missing_job_rejected(self):
        for key in fixture():
            needs = fixture()
            del needs[key]
            with self.assertRaises(ValueError):
                validate_results(needs, SHA)

    def test_failed_selector_or_catalog_rejected(self):
        for key in ("impact", "validate-catalog"):
            needs = fixture()
            needs[key]["result"] = "failure"
            with self.assertRaises(ValueError):
                validate_results(needs, SHA)

    def test_head_mismatch_rejected(self):
        for tested in ("b" * 40, "", None):
            with self.assertRaises(ValueError):
                validate_results(fixture(), tested)

    def test_empty_invalid_or_incomplete_plan_rejected(self):
        for plan in ({}, {"schema": 1, "jobs": {}}, {"schema": 2, "jobs": dict.fromkeys(JOBS, True)},
                     {"schema": True, "jobs": dict.fromkeys(JOBS, True)},
                     {"schema": 1, "jobs": dict.fromkeys(JOBS, "false")},
                     {"schema": 1, "jobs": dict.fromkeys(JOBS, 1)}):
            needs = fixture()
            needs["impact"]["outputs"]["plan"] = json.dumps(plan)
            with self.assertRaises(ValueError):
                validate_results(needs, SHA)

    def test_unexpected_job_is_not_silently_unverified(self):
        needs = fixture()
        needs["new-job"] = {"result": "success"}
        with self.assertRaises(ValueError):
            validate_results(needs, SHA)


if __name__ == "__main__":
    unittest.main()
