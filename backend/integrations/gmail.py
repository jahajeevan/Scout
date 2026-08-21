"""Gmail integration (Phase 4) — read unread summary + send mail.

Reads the account authorized via backend.integrations.google_auth. All calls are
synchronous (googleapiclient); the FastAPI layer runs them on a worker thread.
"""

from __future__ import annotations

import base64
from email.mime.text import MIMEText

from backend.integrations.google_auth import build_service


def _short_from(raw: str) -> str:
    """Turn 'Jane Doe <jane@x.com>' into 'Jane Doe' (or the address)."""
    raw = raw.strip()
    if "<" in raw:
        name = raw.split("<", 1)[0].strip().strip('"')
        return name or raw.split("<", 1)[1].rstrip(">")
    return raw


def get_summary(limit: int = 3) -> dict[str, object]:
    """Unread count + the latest few unread senders/subjects."""
    service = build_service("gmail", "v1")
    if service is None:
        return {"authorized": False, "unread": 0, "messages": []}

    resp = (
        service.users()
        .messages()
        .list(userId="me", q="is:unread", maxResults=limit)
        .execute()
    )
    ids = resp.get("messages", [])
    unread = int(resp.get("resultSizeEstimate", len(ids)))

    messages: list[dict[str, str]] = []
    for m in ids:
        full = (
            service.users()
            .messages()
            .get(
                userId="me",
                id=m["id"],
                format="metadata",
                metadataHeaders=["From", "Subject"],
            )
            .execute()
        )
        headers = {h["name"]: h["value"] for h in full.get("payload", {}).get("headers", [])}
        messages.append(
            {
                "from": _short_from(headers.get("From", "")),
                "subject": headers.get("Subject", "(no subject)"),
            }
        )
    return {"authorized": True, "unread": unread, "messages": messages}


def send_email(to: str, subject: str, body: str) -> bool:
    """Send an email from the authorized account."""
    service = build_service("gmail", "v1")
    if service is None:
        return False
    msg = MIMEText(body)
    msg["to"] = to
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId="me", body={"raw": raw}).execute()
    return True
