import unittest

from tests.render_docs_fixture import fixture


class DocsFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.demo = fixture()

    def test_public_demo_uses_only_fictional_identities(self):
        graph = self.demo["graph"]
        self.assertEqual(len(graph["nodes"]), 8)
        self.assertEqual(len(graph["projects"]), 2)
        self.assertFalse(graph["capabilities"]["can_edit"])
        self.assertTrue(all(n["id"].startswith("demo-") and n["cwd"].startswith("/demo/") for n in graph["nodes"]))
        self.assertNotIn("/Users/", self.demo["html"])

    def test_native_owner_and_business_delegation_stay_separate(self):
        nodes = {node["id"]: node for node in self.demo["graph"]["nodes"]}
        review = nodes["demo-cafe-access"]
        self.assertEqual(review["parent_agent_id"], "demo-cafe-tests")
        self.assertEqual(review["owner_session_id"], "demo-cafe-main")
        launch = nodes["demo-cafe-launch"]
        self.assertEqual(launch["kind"], "session")
        self.assertEqual(launch["business_parent_id"], "demo-cafe-main")
        self.assertEqual(launch["owner_session_id"], launch["id"])

    def test_demo_token_totals_and_pricing_coverage_are_consistent(self):
        total = self.demo["total"]
        self.assertGreater(total["calls"], 0)
        self.assertEqual(total["total_tokens"], total["input_tokens"] + total["output_tokens"])
        self.assertEqual(total["input_tokens"], total["uncached_input_tokens"] + total["cached_input_tokens"])
        self.assertEqual(total["known_price_calls"], total["calls"])
        self.assertEqual(total["unknown_price_tokens"], 0)


if __name__ == "__main__":
    unittest.main()
