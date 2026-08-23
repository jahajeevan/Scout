"""Model catalog — the selectable brains and what each one can actually do.

This is the source of truth the chat UI reads to (a) list models in the switcher
and (b) adapt its controls: image/PDF upload only appears for models whose
capabilities include vision/documents. Adding a model is a one-line entry here —
no other code changes (spec §20 config, §7/§8 vision).

Capabilities:
* ``text``      — normal chat (every model).
* ``tools``     — OpenAI function calling (agent/tool use).
* ``vision``    — accepts images (screenshots, camera, photos).
* ``documents`` — accepts PDFs/images of documents for Q&A (implies vision here,
  since PDF pages are rendered to images for the vision pipeline).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelSpec:
    id: str                    # stable internal id used by the UI + API
    label: str                 # human-facing name
    endpoint: str              # which provider endpoint serves it: "zai" | "nvidia" | "groq"
    remote_id: str             # the model id that endpoint expects
    capabilities: frozenset[str]
    context: int               # approx context window (tokens)
    note: str = ""
    default: bool = False

    def to_public(self, available: bool, active: bool) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "endpoint": self.endpoint,
            "capabilities": sorted(self.capabilities),
            "vision": "vision" in self.capabilities,
            "documents": "documents" in self.capabilities,
            "tools": "tools" in self.capabilities,
            "context": self.context,
            "note": self.note,
            "available": available,   # is this endpoint's key present?
            "active": active,
        }


# Order = display order in the switcher. GLM-5.2 is the default (owner's pick).
# Only models VERIFIED working + reasonably fast on the current NVIDIA tier are
# listed — dead/timeout/500 models were removed so the user never hits a "token
# error" or an endless wait (re-add if the tier improves).
CATALOG: list[ModelSpec] = [
    # ─── Groq — separate model per surface, all on custom LPU silicon ──────
    # Chat: Qwen 3.6 27B — different quota bucket from the NVIDIA-served
    # gpt-oss-20b the user already has, so no rate-limit collision.
    ModelSpec(
        id="qwen3-groq",
        label="Qwen 3.6 27B ⚡",
        endpoint="groq",
        remote_id="qwen/qwen3.6-27b",
        capabilities=frozenset({"text", "tools"}),
        context=131_072,
        note="Fastest chat brain — Qwen on Groq (~600 tok/s). Chat + tools default.",
        default=True,
    ),
    # Code: GPT-OSS 120B — deep reasoning for planning + editing files.
    ModelSpec(
        id="gpt-oss-120b-groq",
        label="GPT-OSS 120B ⚡",
        endpoint="groq",
        remote_id="openai/gpt-oss-120b",
        capabilities=frozenset({"text", "tools"}),
        context=131_072,
        note="Deep-reasoning brain on Groq — Code mode default (~400 tok/s).",
    ),
    # Groq's proprietary compound model — Groq-optimised, small + fast.
    ModelSpec(
        id="groq-compound-mini",
        label="Groq Compound Mini ⚡",
        endpoint="groq",
        remote_id="groq/compound-mini",
        capabilities=frozenset({"text", "tools"}),
        context=131_072,
        note="Groq's in-house compact model — extremely snappy.",
    ),
    # ─── NVIDIA NIM — free tier, more variety but slower ────────────────────
    ModelSpec(
        id="nemotron-3-ultra",
        label="Nemotron-3 Ultra 550B",
        endpoint="nvidia",
        remote_id="nvidia/nemotron-3-ultra-550b-a55b",
        capabilities=frozenset({"text", "tools"}),
        context=128_000,
        note="Flagship on NVIDIA free tier — deep, ~1s first token.",
    ),
    ModelSpec(
        id="gpt-oss-20b",
        label="GPT-OSS 20B",
        endpoint="nvidia",
        remote_id="openai/gpt-oss-20b",
        capabilities=frozenset({"text", "tools"}),
        context=128_000,
        note="OpenAI's open model on NVIDIA — quick (~0.7s), reliable fallback.",
    ),
    ModelSpec(
        id="nemotron-3-nano-omni",
        label="Nemotron-3 Nano Omni",
        endpoint="nvidia",
        remote_id="nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        capabilities=frozenset({"text", "tools"}),
        context=128_000,
        note="Fast reasoning model (~3s).",
    ),
    ModelSpec(
        id="nemotron-super-49b",
        label="Nemotron Super 49B",
        endpoint="nvidia",
        remote_id="nvidia/llama-3.3-nemotron-super-49b-v1.5",
        capabilities=frozenset({"text", "tools"}),
        context=128_000,
        note="Mid-size reasoning brain (~5s) — a balanced step below Ultra.",
    ),
    ModelSpec(
        id="llama-3.2-11b-vision",
        label="Llama 3.2 11B Vision",
        endpoint="nvidia",
        remote_id="meta/llama-3.2-11b-vision-instruct",
        capabilities=frozenset({"text", "vision", "documents"}),
        context=128_000,
        note="Lightweight, very fast vision model.",
    ),
]

_BY_ID = {m.id: m for m in CATALOG}


def get_spec(model_id: str) -> ModelSpec | None:
    return _BY_ID.get(model_id)


def default_spec() -> ModelSpec:
    for m in CATALOG:
        if m.default:
            return m
    return CATALOG[0]
