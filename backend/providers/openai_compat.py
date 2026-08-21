"""OpenAI-compatible provider — one client for every Bearer-token chat endpoint.

Both NVIDIA NIM (``integrate.api.nvidia.com``) and Z.AI (``api.z.ai``) expose the
exact OpenAI Chat Completions shape, so a single implementation serves both —
only the base URL, key, and a human hint differ. This is the concrete brain
behind every model in the catalog (spec §2, §21).

Design notes for JARVIS's use:
* ``model`` is passed **per call** (the endpoint hosts many models); the instance
  default is only a convenience.
* Fail-fast timeout — a voice assistant must never hang on a cold/overloaded
  model; it raises a clean error the caller surfaces honestly.
* Reasoning models (GLM-5.2, Nemotron) spend tokens on hidden reasoning before
  the answer, so the token budget is generous and ``reasoning_content`` is kept
  for the observability panel but never shown as the answer.
* Vision: OpenAI ``image_url`` content blocks pass straight through, so a
  multimodal model works through this same class with no separate code path.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from backend.providers.base import AIProvider, Completion, Message, ToolCall

_TIMEOUT = httpx.Timeout(connect=8.0, read=45.0, write=10.0, pool=8.0)
_MAX_TOKENS = 2048


class OpenAICompatibleProvider(AIProvider):
    def __init__(
        self,
        name: str,
        api_key: str | None,
        base_url: str,
        *,
        default_model: str = "",
        key_env: str = "the API key",
        max_tokens: int = _MAX_TOKENS,
        temperature: float = 0.6,
    ) -> None:
        self.name = name
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._default_model = default_model
        self._key_env = key_env
        self._max_tokens = max_tokens
        self._temperature = temperature

    def model(self) -> str:
        return self._default_model

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    @property
    def supports_tools(self) -> bool:
        return True

    @property
    def supports_vision(self) -> bool:
        return True

    # -- internals ----------------------------------------------------------

    def _require_key(self) -> None:
        if not self._api_key:
            raise RuntimeError(
                f"{self._key_env} is not set — add it to .env and restart. "
                f"JARVIS never answers from a model you didn't select."
            )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key or ''}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _payload(
        self,
        messages: list[Message],
        system: str | None,
        tools: list[dict[str, Any]] | None,
        model: str | None,
        stream: bool,
    ) -> dict[str, Any]:
        msgs: list[Message] = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.extend(messages)
        payload: dict[str, Any] = {
            "model": model or self._default_model,
            "messages": msgs,
            "max_tokens": self._max_tokens,
            "temperature": self._temperature,
            "stream": stream,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        return payload

    async def stream(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        self._require_key()
        payload = self._payload(messages, system, tools, model, stream=True)
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream(
                "POST", f"{self._base_url}/chat/completions", headers=self._headers(), json=payload
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise RuntimeError(f"{self.name} API {response.status_code}: {body[:400]}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    parsed = _loads(data)
                    for choice in parsed.get("choices", []):
                        chunk = (choice.get("delta") or {}).get("content")
                        if chunk:
                            yield chunk

    async def stream_events(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ):
        """Stream a turn as events: {"type":"text","text"} and, at the end,
        {"type":"tool_calls","calls":[ToolCall,...]} if the model asked for tools.

        This is the unified agentic-streaming path: the chat streams tokens live
        AND can call tools in the same turn (spec §19/§9).
        """
        self._require_key()
        payload = self._payload(messages, system, tools, model, stream=True)
        # id -> {"name":..., "args": "<partial json>"} accumulated across deltas
        pending: dict[int, dict] = {}
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            async with client.stream(
                "POST", f"{self._base_url}/chat/completions", headers=self._headers(), json=payload
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise RuntimeError(f"{self.name} API {response.status_code}: {body[:400]}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    parsed = _loads(data)
                    for choice in parsed.get("choices", []):
                        delta = choice.get("delta") or {}
                        text = delta.get("content")
                        if text:
                            yield {"type": "text", "text": text}
                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            slot = pending.setdefault(idx, {"id": tc.get("id", ""), "name": "", "args": ""})
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["name"] = fn["name"]
                            if fn.get("arguments"):
                                slot["args"] += fn["arguments"]
        if pending:
            calls = [
                ToolCall(id=s["id"] or f"call_{i}", name=s["name"], arguments=_loads(s["args"] or "{}"))
                for i, s in sorted(pending.items())
                if s["name"]
            ]
            if calls:
                yield {"type": "tool_calls", "calls": calls}

    async def complete(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> Completion:
        self._require_key()
        payload = self._payload(messages, system, tools, model, stream=False)
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                f"{self._base_url}/chat/completions", headers=self._headers(), json=payload
            )
            if response.status_code >= 400:
                raise RuntimeError(f"{self.name} API {response.status_code}: {response.text[:400]}")
            data = response.json()
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        calls: list[ToolCall] = []
        for tc in message.get("tool_calls") or []:
            fn = tc.get("function") or {}
            calls.append(
                ToolCall(id=tc.get("id", ""), name=fn.get("name", ""), arguments=_loads(fn.get("arguments") or "{}"))
            )
        usage = data.get("usage") or {}
        if message.get("reasoning_content"):
            usage["reasoning_content"] = message["reasoning_content"]
        return Completion(
            text=message.get("content") or "",
            tool_calls=calls,
            model=data.get("model", model or self._default_model),
            usage=usage,
            finish_reason=choice.get("finish_reason") or "",
        )


def _loads(raw: str) -> dict:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
