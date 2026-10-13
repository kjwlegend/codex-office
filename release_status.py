"""Read public GitHub release metadata on demand, without local account data."""

import json
import re
import threading
import time
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from app_version import REPOSITORY, REPOSITORY_URL, VERSION, app_metadata


_SEMVER = re.compile(
    r"^[vV]?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


def _version(value):
    match = _SEMVER.fullmatch(value)
    if not match:
        return None
    prerelease = match[4].split(".") if match[4] else []
    if any(part.isdigit() and len(part) > 1 and part.startswith("0") for part in prerelease):
        return None
    return tuple(int(match[index]) for index in (1, 2, 3)), prerelease


def compare_versions(current, latest):
    """Return -1/0/1 by SemVer precedence, or None for unsupported tags."""
    left, right = _version(current), _version(latest)
    if left is None or right is None:
        return None
    if left[0] != right[0]:
        return 1 if left[0] > right[0] else -1
    a, b = left[1], right[1]
    if not a or not b:
        return 0 if a == b else (1 if not a else -1)
    for x, y in zip(a, b):
        if x == y:
            continue
        if x.isdigit() and y.isdigit():
            return 1 if int(x) > int(y) else -1
        if x.isdigit() != y.isdigit():
            return -1 if x.isdigit() else 1
        return 1 if x > y else -1
    return (len(a) > len(b)) - (len(a) < len(b))


class ReleaseChecker:
    def __init__(self):
        self.lock = threading.Lock()
        self.cached = None
        self.cached_at = 0

    def status(self, refresh=False):
        # Normal opens reuse a 15-minute result; manual retries share a 10-second
        # cooldown. Holding the lock also coalesces checks across browser tabs.
        with self.lock:
            age = time.monotonic() - self.cached_at
            ttl = 10 if refresh or (self.cached and self.cached["status"] == "error") else 900
            if self.cached is not None and age < ttl:
                return dict(self.cached)
            result = {**app_metadata(), **self._fetch(),
                      "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            self.cached = result
            self.cached_at = time.monotonic()
            return dict(result)

    @staticmethod
    def _fetch():
        request = Request(f"https://api.github.com/repos/{REPOSITORY}/releases/latest", headers={
            "Accept": "application/vnd.github+json", "User-Agent": f"Codex-Office/{VERSION}",
        })
        try:
            with urlopen(request, timeout=5) as response:
                raw = response.read(512 * 1024 + 1)
            if len(raw) > 512 * 1024:
                raise ValueError("Release response too large")
            release = json.loads(raw)
            tag = release.get("tag_name")
            if not isinstance(tag, str) or not tag or len(tag) > 128 or release.get("draft") or release.get("prerelease"):
                raise ValueError("Invalid latest release")
            relation = compare_versions(VERSION, tag)
            status = {None: "uncomparable", -1: "update_available", 0: "up_to_date", 1: "local_ahead"}[relation]
            return {"status": status, "latest_version": tag,
                    "release_url": f"{REPOSITORY_URL}/releases/tag/{quote(tag, safe='')}"}
        except HTTPError as error:
            code = error.code
            error.close()
            if code == 404:
                return {"status": "no_release"}
            return {"status": "error", "reason": "rate_limit" if code in (403, 429) else "network"}
        except (OSError, ValueError, TypeError, AttributeError):
            return {"status": "error", "reason": "network"}
