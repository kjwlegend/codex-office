"""Release checks use synthetic upstream responses, never account records."""

import io
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from app_version import REPOSITORY_URL, VERSION, app_metadata
from release_status import ReleaseChecker, compare_versions
from workspace_server import WorkspaceServer


class ReleaseStatusTests(unittest.TestCase):
    def response(self, tag, **extra):
        return io.BytesIO(json.dumps({"tag_name": tag, "draft": False, "prerelease": False, **extra}).encode())

    def test_semver_compares_numeric_components_and_ignores_build_metadata(self):
        for current, latest, expected in (
            ("v0.3.0", "v0.10.0", -1), ("v0.3.0", "0.3.0", 0),
            ("v1.0.0", "v0.99.99", 1), ("1.2.10", "1.2.9", 1),
            ("v0.3.0+local", "v0.3.0+release", 0),
        ):
            with self.subTest(current=current, latest=latest):
                self.assertEqual(compare_versions(current, latest), expected)

    def test_semver_prerelease_precedence_and_unrecognized_tags(self):
        versions = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta",
                    "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"]
        for left, right in zip(versions, versions[1:]):
            self.assertEqual(compare_versions(left, right), -1)
            self.assertEqual(compare_versions(right, left), 1)
        for tag in ("latest", "2026-10-13", "v0.3", "v00.3.0", "0.3.0-01", "0.3.0-beta..1", "v0.٣.0"):
            self.assertIsNone(compare_versions("v0.3.0", tag), tag)

    def test_latest_release_yields_a_truthful_comparison(self):
        for tag, expected in (("v0.4.0", "update_available"), (f"v{VERSION}", "up_to_date"),
                              ("v0.2.9", "local_ahead"), ("daily", "uncomparable")):
            with self.subTest(tag=tag), patch("release_status.urlopen", return_value=self.response(tag)):
                result = ReleaseChecker().status()
                self.assertEqual(result["status"], expected)
                self.assertEqual(result["current_version"], f"v{VERSION}")
                self.assertEqual(result["latest_version"], tag)
                self.assertEqual(result["release_url"], REPOSITORY_URL + "/releases/tag/" + tag)

    def test_request_only_contains_public_repository_metadata(self):
        with patch("release_status.urlopen", return_value=self.response(f"v{VERSION}")) as upstream:
            ReleaseChecker().status()
        request = upstream.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.github.com/repos/kjwlegend/codex-office/releases/latest")
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertIsNone(request.get_header("Authorization"))
        self.assertEqual(upstream.call_args.kwargs["timeout"], 5)

    def test_no_release_and_network_failures_do_not_claim_latest(self):
        for error, status, reason in (
            (HTTPError("https://api.github.com", 404, "Not Found", {}, None), "no_release", None),
            (HTTPError("https://api.github.com", 403, "Limited", {}, None), "error", "rate_limit"),
            (HTTPError("https://api.github.com", 429, "Limited", {}, None), "error", "rate_limit"),
            (HTTPError("https://api.github.com", 500, "Unavailable", {}, None), "error", "network"),
            (URLError("Offline"), "error", "network"), (TimeoutError(), "error", "network"),
        ):
            with self.subTest(error=error), patch("release_status.urlopen", side_effect=error):
                result = ReleaseChecker().status()
                self.assertEqual(result["status"], status)
                self.assertEqual(result.get("reason"), reason)
                self.assertNotIn("latest_version", result)

    def test_invalid_or_unpublished_response_is_not_a_success(self):
        for data in (b'[]', b'broken JSON', b'{}', b'x' * (512 * 1024 + 1)):
            with patch("release_status.urlopen", return_value=io.BytesIO(data)):
                self.assertEqual(ReleaseChecker().status()["status"], "error")
        for extra in ({"draft": True}, {"prerelease": True}):
            with patch("release_status.urlopen", return_value=self.response("v1.0.0", **extra)):
                self.assertEqual(ReleaseChecker().status()["status"], "error")

    def test_cache_coalesces_tabs_and_manual_retries_then_allows_a_new_release(self):
        checker = ReleaseChecker()
        with patch("release_status.time.monotonic", return_value=100), patch("release_status.urlopen", return_value=self.response(f"v{VERSION}")) as upstream:
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: checker.status(), range(4)))
            self.assertTrue(all(result["status"] == "up_to_date" for result in results))
            checker.status(refresh=True)
            upstream.assert_called_once()
        with patch("release_status.time.monotonic", return_value=111), patch("release_status.urlopen", return_value=self.response("v0.4.0")) as upstream:
            self.assertEqual(checker.status()["status"], "up_to_date")
            upstream.assert_not_called()
            self.assertEqual(checker.status(refresh=True)["status"], "update_available")
            upstream.assert_called_once()

    def test_error_cache_expires_for_retry(self):
        checker = ReleaseChecker()
        with patch("release_status.time.monotonic", return_value=100), patch("release_status.urlopen", side_effect=URLError("Offline")):
            self.assertEqual(checker.status()["status"], "error")
        with patch("release_status.time.monotonic", return_value=111), patch("release_status.urlopen", return_value=self.response(f"v{VERSION}")):
            self.assertEqual(checker.status()["status"], "up_to_date")

    def test_local_api_serves_version_status_without_loading_account_records(self):
        with tempfile.TemporaryDirectory() as temp:
            server = WorkspaceServer(("127.0.0.1", 0), None, Path(temp) / "report.html")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with patch.object(server.release_checker, "status", return_value={**app_metadata(), "status": "no_release"}) as check:
                    with urlopen(f"http://127.0.0.1:{server.server_port}/api/release?refresh=1", timeout=2) as response:
                        result = json.load(response)
                    check.assert_called_once_with(refresh=True)
                    self.assertEqual(result["status"], "no_release")
                    self.assertEqual(result["current_version"], f"v{VERSION}")
                with urlopen(f"http://127.0.0.1:{server.server_port}/api/health", timeout=2) as response:
                    self.assertEqual(json.load(response)["version"], VERSION)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
