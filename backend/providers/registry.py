"""Provider registry — the selectable model catalog and the current selection.

JARVIS exposes several models the user picks between **in the chat** (spec §20).
This is explicit selection, not automatic fallback: JARVIS only ever answers from
the model you chose. If that model's endpoint has no key or is unreachable, the
call raises a clear error — it never silently swaps in a different model.

Two endpoints back the catalog (both OpenAI-compatible): Z.AI for GLM-5.2, NVIDIA
NIM for the rest. Selection state is module-level and flippable at runtime.
"""

from __future__ import annotations

from backend.config import (
    DEFAULT_MODEL,
    NVIDIA_API_KEY,
    NVIDIA_BASE_URL,
    ZAI_API_KEY,
    ZAI_BASE_URL,
)
from backend.providers.base import AIProvider
from backend.providers.catalog import CATALOG, ModelSpec, default_spec, get_spec
from backend.providers.openai_compat import OpenAICompatibleProvider

# One provider instance per endpoint; the model is chosen per call.
_ENDPOINTS: dict[str, OpenAICompatibleProvider] = {
    "zai": OpenAICompatibleProvider(
        "zai", ZAI_API_KEY, ZAI_BASE_URL, key_env="ZAI_API_KEY"
    ),
    "nvidia": OpenAICompatibleProvider(
        "nvidia", NVIDIA_API_KEY, NVIDIA_BASE_URL, key_env="NVIDIA_API_KEY"
    ),
}

_active_id: str = DEFAULT_MODEL if get_spec(DEFAULT_MODEL) else default_spec().id


def _endpoint_available(spec: ModelSpec) -> bool:
    ep = _ENDPOINTS.get(spec.endpoint)
    return bool(ep and ep.available)


# -- selection ---------------------------------------------------------------

def active_spec() -> ModelSpec:
    return get_spec(_active_id) or default_spec()


def active() -> AIProvider:
    """The endpoint serving the currently-selected model."""
    return _ENDPOINTS[active_spec().endpoint]


def active_name() -> str:
    """Provider name for status display (the endpoint, e.g. 'zai')."""
    return active().name


def active_remote_model() -> str:
    """The concrete remote model id for the current selection."""
    return active_spec().remote_id


def provider_for(model_id: str | None) -> tuple[AIProvider, ModelSpec]:
    """Resolve a catalog id (or None → active) to its endpoint + spec."""
    spec = get_spec(model_id) if model_id else None
    spec = spec or active_spec()
    return _ENDPOINTS[spec.endpoint], spec


def set_active(model_id: str) -> dict:
    """Select a model by catalog id. Explicit, per the owner's design."""
    global _active_id
    spec = get_spec(model_id)
    if spec is None:
        return {"ok": False, "reason": f"unknown model {model_id!r}", "model": _active_id}
    _active_id = spec.id
    return {"ok": True, "model": spec.id, "label": spec.label, "endpoint": spec.endpoint}


def list_models() -> list[dict]:
    """Serializable catalog for the chat switcher (capabilities + availability)."""
    return [
        spec.to_public(available=_endpoint_available(spec), active=(spec.id == _active_id))
        for spec in CATALOG
    ]
