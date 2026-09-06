import copy
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import Mock, patch

import factory_handoff as handoff


class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.pr = {"number": 576, "state": "open", "body": "Refs #573\n$(secret)",
                   "title": "Private PR title", "merged": False, "merged_at": None,
                   "draft": True, "labels": [{"name": "type:chore"}],
                   "head": {"sha": "a" * 40, "ref": "candidate",
                            "repo": {"full_name": handoff.REPOSITORY}},
                   "base": {"sha": "b" * 40, "ref": "main",
                            "repo": {"full_name": handoff.REPOSITORY}}}
        self.issue = {"number": 573, "state": "open", "title": "Private issue title",
                      "body": "Acceptance scope", "labels": [{"name": "status:approved"}],
                      "url": f"https://api.github.com/repos/{handoff.REPOSITORY}/issues/573"}

    def build(self, responses=None, **pins):
        args = {"number": 576, "head": "a" * 40, "base": "b" * 40,
                "issue_number": 573, **pins}
        self.get = Mock(side_effect=responses if responses is not None else
                        [self.pr, self.issue, self.pr, self.issue])
        return handoff.build(**args, get=self.get)

    def test_exact_manifest_and_read_order_without_prose(self):
        before = copy.deepcopy([self.pr, self.issue])
        result = self.build()
        self.assertEqual([self.pr, self.issue], before)
        self.assertEqual((result["pr"], result["issue"], result["head_sha"], result["base_sha"]),
                         (576, 573, "a" * 40, "b" * 40))
        self.assertEqual((result["approval"], result["receipt"], result["dispatch"]),
                         ("none", "not-issued", "not-started"))
        for field in ("pr_scope_sha256", "issue_scope_sha256"):
            self.assertRegex(result[field], r"^[0-9a-f]{64}$")
        self.assertEqual(len(self.get.call_args_list), 4)
        self.assertEqual([c.args[0].rsplit("/", 2)[1:] for c in self.get.call_args_list],
                         [["pulls", "576"], ["issues", "573"]] * 2)
        for prose in ("secret", "Private", "Acceptance", "candidate"):
            self.assertNotIn(prose, json.dumps(result))

    def test_pins_rejected_before_network(self):
        for pins in ({"number": True}, {"number": 576.0}, {"number": 0},
                     {"issue_number": True}, {"issue_number": 573.0},
                     {"head": None}, {"head": "a" * 39}, {"head": "A" * 40},
                     {"base": "../secret"}):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                self.build(**pins)
            self.get.assert_not_called()

    def test_wrong_caller_context(self):
        for pins in ({"number": 577}, {"issue_number": 574},
                     {"head": "c" * 40}, {"base": "c" * 40}):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                self.build(**pins)

    def test_invalid_pr_and_issue_records(self):
        for target, mutations in (("pr", [
                {"number": 576.0}, {"number": True}, {"state": "closed"},
                {"merged": True}, {"merged": 0}, {"merged_at": "yesterday"},
                {"draft": 1}, {"title": None}, {"body": "Refs other/repo#573"},
                {"labels": []}, {"labels": [{"name": "type:no"}]},
                {"labels": [{"name": "type:chore"}] * 2},
                {"head": {"sha": "a" * 40, "ref": "branch", "repo": None}},
                {"head": {"sha": "a" * 40, "ref": "branch",
                          "repo": {"full_name": "other/repo"}}},
                {"base": {"sha": "b" * 40, "ref": "dev",
                          "repo": {"full_name": handoff.REPOSITORY}}}]),
                ("issue", [{"number": 573.0}, {"pull_request": {}}, {"state": "closed"},
                           {"body": None}, {"url": "https://evil/issues/573"},
                           {"labels": []}, {"labels": [{"name": "status:blocked"}]},
                           {"labels": [{"name": "status:approved"}] * 2}])):
            for mutation in mutations:
                self.setUp()
                getattr(self, target).update(mutation)
                with self.subTest(target=target, mutation=mutation), self.assertRaises(Exception):
                    self.build()

    def test_scope_drift_on_either_reread(self):
        for target, mutation in (("pr", {"body": "Refs #573\nNew scope"}),
                                 ("pr", {"title": "New title"}), ("pr", {"draft": False}),
                                 ("pr", {"head": {**self.pr["head"], "sha": "c" * 40}}),
                                 ("issue", {"body": "Changed acceptance"}),
                                 ("issue", {"title": "Changed title"}),
                                 ("issue", {"labels": []}), ("issue", {"state": "closed"})):
            pr, issue = copy.deepcopy([self.pr, self.issue])
            (pr if target == "pr" else issue).update(mutation)
            with self.subTest(target=target, mutation=mutation), self.assertRaises(Exception):
                self.build([self.pr, self.issue, pr, issue])

    def test_volatile_fields_and_label_order_are_ignored(self):
        self.pr["labels"].append({"name": "area:factory"})
        self.issue["labels"].append({"name": "priority:p1"})
        pr, issue = copy.deepcopy([self.pr, self.issue])
        for record in (pr, issue):
            record.update(comments=9, updated_at="new", mergeable=True)
            record["labels"].reverse()
        result = self.build([self.pr, self.issue, pr, issue])
        self.assertEqual(result["pr_scope_sha256"], self.build()["pr_scope_sha256"])

    def test_api_failures_at_every_read(self):
        good = [self.pr, self.issue, self.pr, self.issue]
        for index in range(4):
            for invalid in (None, {}, [], "secret", OSError("secret-token")):
                with self.subTest(index=index, invalid=invalid), self.assertRaises(Exception):
                    self.build(good[:index] + [invalid])

    def test_cli_json_success_and_redacted_failures(self):
        args = ["--pr", "576", "--issue", "573", "--head", "a" * 40, "--base", "b" * 40]
        manifest = self.build()
        with patch.dict("os.environ", {"GITHUB_TOKEN": "secret-token"}), \
                patch.object(handoff, "build", return_value=manifest), \
                redirect_stdout(io.StringIO()) as stdout, redirect_stderr(io.StringIO()) as stderr:
            self.assertEqual(handoff.main(args), 0)
            self.assertEqual(json.loads(stdout.getvalue()), manifest)
            self.assertEqual(stderr.getvalue(), "")
        for argv, token in ((args, ""), (["--pr", "secret-token"], "token"), (args, "token")):
            with patch.dict("os.environ", {"GITHUB_TOKEN": token}), \
                    patch.object(handoff, "build", side_effect=OSError("secret-token private body")), \
                    redirect_stdout(io.StringIO()) as stdout, redirect_stderr(io.StringIO()) as stderr:
                self.assertEqual(handoff.main(argv), 1)
                self.assertEqual(stdout.getvalue(), "")
                self.assertNotIn("secret-token", stderr.getvalue())
                self.assertNotIn("private body", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
