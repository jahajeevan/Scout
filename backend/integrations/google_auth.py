"""Shared Google OAuth helper for the Gmail + Calendar integrations (Phase 4).

Uses the installed-app (desktop) OAuth flow. The client secret lives in
``config/google_credentials.json`` (gitignored); the resulting token is cached in
``config/google_token.json`` (also gitignored) and auto-refreshed.

One-time authorization (opens a browser for you to consent) — run once::

    python3.11 -m backend.integrations.google_auth

After that the backend reads the cached token non-interactively.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent.parent
_CRED_PATH = _ROOT / "config" / "google_credentials.json"
_TOKEN_PATH = _ROOT / "config" / "google_token.json"

# Only what the panels/commands need: read mail, send mail, read calendar.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
]


def get_credentials(interactive: bool = False) -> Any | None:
    """Return valid Google credentials, or None if not authorized yet.

    ``interactive=True`` runs the browser consent flow (used by the one-time CLI).
    """
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = None
    if _TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(_TOKEN_PATH), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            _TOKEN_PATH.write_text(creds.to_json())
            return creds
        except Exception:
            creds = None

    if interactive:
        from google_auth_oauthlib.flow import InstalledAppFlow

        if not _CRED_PATH.exists():
            raise FileNotFoundError(f"Missing {_CRED_PATH} — download it from Google Cloud.")
        flow = InstalledAppFlow.from_client_secrets_file(str(_CRED_PATH), SCOPES)
        creds = flow.run_local_server(port=0)
        _TOKEN_PATH.write_text(creds.to_json())
        return creds

    return None


def build_service(api: str, version: str) -> Any | None:
    """Build a Google API client, or None if not authorized."""
    creds = get_credentials(interactive=False)
    if creds is None:
        return None
    from googleapiclient.discovery import build

    return build(api, version, credentials=creds, cache_discovery=False)


if __name__ == "__main__":
    print("[google] Opening browser for one-time consent...")
    get_credentials(interactive=True)
    print(f"[google] Authorized. Token cached at {_TOKEN_PATH}")
