"""Public application metadata; update VERSION for each local release."""

VERSION = "0.3.1"
REPOSITORY = "kjwlegend/codex-office"
REPOSITORY_URL = f"https://github.com/{REPOSITORY}"
RELEASES_URL = f"{REPOSITORY_URL}/releases"


def app_metadata():
    return {"current_version": f"v{VERSION}", "repository_url": REPOSITORY_URL,
            "releases_url": RELEASES_URL}
