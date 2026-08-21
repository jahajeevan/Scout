"""Spotify integration (Phase 4) — now-playing + playback control.

Client ID comes from config; the secret from the SPOTIFY_CLIENT_SECRET env var.
Uses spotipy's Authorization-Code flow with a cached token.

One-time authorization (opens a browser; after approving, paste the redirected
127.0.0.1 URL back into the terminal when prompted)::

    export SPOTIFY_CLIENT_SECRET="...your secret..."
    python3.11 -m backend.integrations.spotify

Note: reading the current track works on Spotify Free; play/pause/next require
Spotify Premium.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.config import SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI

_CACHE = Path(__file__).resolve().parent.parent.parent / ".spotify_cache"
_SCOPE = "user-read-playback-state user-modify-playback-state user-read-currently-playing"


def _oauth() -> Any | None:
    if not (SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET):
        return None
    from spotipy.oauth2 import SpotifyOAuth

    return SpotifyOAuth(
        client_id=SPOTIFY_CLIENT_ID,
        client_secret=SPOTIFY_CLIENT_SECRET,
        redirect_uri=SPOTIFY_REDIRECT_URI,
        scope=_SCOPE,
        cache_path=str(_CACHE),
        open_browser=True,
    )


def _client(interactive: bool = False) -> Any | None:
    """Build a Spotify client from the cached token (None if not authorized)."""
    oauth = _oauth()
    if oauth is None:
        return None
    if not interactive and oauth.cache_handler.get_cached_token() is None:
        return None
    import spotipy

    return spotipy.Spotify(auth_manager=oauth)


def get_now_playing() -> dict[str, object]:
    """Current track, artist, and play/pause state."""
    sp = _client()
    if sp is None:
        return {"authorized": False, "playing": False}
    try:
        current = sp.current_playback()
    except Exception:
        return {"authorized": True, "playing": False}
    if not current or not current.get("item"):
        return {"authorized": True, "playing": False}
    item = current["item"]
    return {
        "authorized": True,
        "playing": bool(current.get("is_playing", False)),
        "track": item.get("name", ""),
        "artist": ", ".join(a["name"] for a in item.get("artists", [])),
    }


def control(action: str) -> bool:
    """Playback control: play | pause | next | previous (Premium required)."""
    sp = _client()
    if sp is None:
        return False
    try:
        if action == "play":
            sp.start_playback()
        elif action == "pause":
            sp.pause_playback()
        elif action == "next":
            sp.next_track()
        elif action == "previous":
            sp.previous_track()
        else:
            return False
    except Exception:
        return False
    return True


def play_search(query: str) -> bool:
    """Search for a track and start playing the top result (Premium required)."""
    sp = _client()
    if sp is None:
        return False
    try:
        results = sp.search(q=query, type="track", limit=1)
        tracks = results.get("tracks", {}).get("items", [])
        if not tracks:
            return False
        sp.start_playback(uris=[tracks[0]["uri"]])
    except Exception:
        return False
    return True


if __name__ == "__main__":
    if _oauth() is None:
        print("[spotify] Set SPOTIFY_CLIENT_SECRET (and spotify_client_id in config).")
    else:
        print("[spotify] Opening browser for one-time consent...")
        _client(interactive=True)  # triggers the auth flow + caches the token
        print("[spotify] Authorized.")
