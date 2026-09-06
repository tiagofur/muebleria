import copy
import io
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

import check_pr_metadata as gate


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.repo = "tiagofur/muebleria"
        self.pr = {"number": 574, "state": "open", "body": "Closes #573\nSummary\n",
                   "head": {"sha": "a" * 40},
                   "base": {"ref": "main", "sha": "c" * 40, "repo": {"full_name": self.repo}},
                   "labels": [{"name": "type:chore"}]}
        self.event = {"number": 574, "repository": {"full_name": self.repo},
                      "pull_request": copy.deepcopy(self.pr)}
        self.issue = {"number": 573, "state": "open",
                      "url": f"https://api.github.com/repos/{self.repo}/issues/573",
                      "labels": [{"name": "status:approved"}]}

    def validate(self):
        return gate.validate(self.event, self.repo, self.pr, self.issue)

    def test_supported_types_and_keywords(self):
        for label in gate.TYPES:
            for keyword in ("Closes", "fIxEs", "Resolves"):
                self.pr["labels"] = [{"name": label}]
                self.pr["body"] = f"\n{keyword} #573\nNormal prose fixes behavior."
                self.assertEqual(self.validate(), 573)

    def test_references_fail_closed(self):
        for body in (None, "No link", "Closes #0", "Closes #573 and #574",
                     "Closes: #573", "Closes #573.", "Closes other/repo#573",
                     "Closes https://github.com/other/repo/issues/573",
                     "Closes #573\nFixes #574", "Closes #573\nFixes #573",
                     "Closes #573\nAlso fixes #574", "```\nCloses #573\n```",
                     "<!--\nCloses #573\n-->", "Closes #573\nClose #574",
                     "Closes #573\nFixed #574", "Closes #573\nResolved #574",
                     "Closes #573\nClosed #574"):
            with self.subTest(body=body), self.assertRaises(ValueError):
                self.pr["body"] = body
                self.validate()

    def test_partial_reference_preserves_approval_and_open_parent(self):
        self.pr["body"] = "rEfS #573\n## Delivered scope\nMetadata gate.\n## Remaining scope\nQueue."
        before = copy.deepcopy(self.issue)
        get = unittest.mock.Mock(side_effect=[self.pr, self.issue, self.pr])
        self.assertEqual(gate.check(self.event, self.repo, get), 573)
        self.assertEqual(self.issue, before)
        for change in ({"labels": []}, {"state": "closed"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                gate.validate(self.event, self.repo, self.pr, {**self.issue, **change})

    def test_partial_reference_rejects_ambiguous_and_malformed_links(self):
        scope = "\n## Delivered scope\nGate.\n## Remaining scope\nQueue."
        for body in ("Refs #573" + scope + "\nCloses #573",
                     "Refs #573" + scope + "\nRefs #574",
                     "Closes #573\nRefs #574", "Refs other/repo#573" + scope,
                     "Refs #573." + scope, "<!--\nRefs #573\n-->" + scope,
                     "Refs #573" + scope + "\nResolves other/repo#574"):
            with self.subTest(body=body), self.assertRaises(ValueError):
                gate.linked_issue(body)

    def test_issue_rejections(self):
        for change in ({"state": "closed"}, {"pull_request": {}}, {"number": 574}, {"number": 573.0},
                       {"url": "https://api.github.com/repos/other/repo/issues/573"},
                       {"labels": []}, {"labels": [{"name": "status:pending"}]},
                       {"labels": [{"name": "status:approved"}, {"name": "status:blocked"}]},
                       {"labels": None}, {"labels": ["status:approved"]}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.issue = {**self.issue, **change}
                self.validate()
            self.setUp()

    def test_pr_rejections(self):
        for change in ({"labels": []}, {"labels": [{"name": "type:unknown"}]},
                       {"labels": [{"name": "type:chore"}, {"name": "type:docs"}]},
                       {"head": {"sha": "b" * 40}}, {"state": "closed"},
                       {"number": 575}, {"number": 574.0}, {"base": {"ref": "other", "repo": {"full_name": self.repo}}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.pr.update(change)
                self.validate()
            self.setUp()

    def test_transport_reads_live_metadata_and_keeps_shell_text_as_data(self):
        self.pr["body"] += "$(touch /tmp/do-not-run); `echo data`\n"
        get = unittest.mock.Mock(side_effect=[self.pr, self.issue, self.pr])
        self.assertEqual(gate.check(self.event, self.repo, get), 573)
        self.assertEqual([call.args[0] for call in get.call_args_list], [
            f"/repos/{self.repo}/pulls/574", f"/repos/{self.repo}/issues/573",
            f"/repos/{self.repo}/pulls/574"])

    def test_api_failure_malformed_response_and_concurrent_change(self):
        for responses in ([OSError("secret")], [None], [{}],
                          [self.pr, None], [self.pr, {}, self.pr],
                          [self.pr, self.issue, {**self.pr, "body": "changed"}]):
            with self.subTest(responses=responses), self.assertRaises(Exception):
                gate.check(self.event, self.repo, unittest.mock.Mock(side_effect=responses))

    def test_volatile_api_fields_do_not_invalidate_pinned_metadata(self):
        current = {**self.pr, "mergeable": True, "comments": 3}
        get = unittest.mock.Mock(side_effect=[self.pr, self.issue, current])
        self.assertEqual(gate.check(self.event, self.repo, get), 573)

    def test_base_sha_and_label_drift_fail(self):
        current = copy.deepcopy(self.pr)
        current["base"]["sha"] = "d" * 40
        changed_labels = {**self.pr, "labels": [{"name": "type:docs"}]}
        for changed in (current, changed_labels):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                gate.check(self.event, self.repo, unittest.mock.Mock(
                    side_effect=[self.pr, self.issue, changed]))

    def test_bad_event_cannot_route_api(self):
        self.event["number"] = "574/../../issues"
        get = unittest.mock.Mock()
        with self.assertRaises(ValueError):
            gate.check(self.event, self.repo, get)
        get.assert_not_called()

    def test_cli_failure_is_nonzero_and_redacted(self):
        with patch.dict("os.environ", {"GITHUB_EVENT_PATH": "/missing/secret-token"}), \
                redirect_stderr(io.StringIO()) as output:
            self.assertEqual(gate.main(), 1)
        self.assertNotIn("secret-token", output.getvalue())


if __name__ == "__main__":
    unittest.main()
