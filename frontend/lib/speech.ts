// Single shared speech player so only one message speaks at a time, and any new
// Speak (or Talk) interrupts the previous one. Subscribers get notified which
// message id is currently speaking so the UI can toggle Speak/Stop.
//
// Playback uses the backend's SSE /speak_stream endpoint: the server emits one
// audio chunk per sentence, and we start playing chunk 0 as soon as it lands
// while later chunks continue arriving. On any streaming error we fall back to
// the one-shot /speak endpoint so the message still gets spoken.

type Listener = (speakingId: number | null) => void;

let audio: HTMLAudioElement | null = null;
let currentId: number | null = null;
let currentAbort: AbortController | null = null;
let currentToken = 0; // increments on every speak(); playback loops check it
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((l) => l(currentId));
}

export function onSpeakingChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function speakingId(): number | null {
  return currentId;
}

export function stop(): void {
  currentToken++; // any in-flight loop will notice and bail
  if (currentAbort) {
    try { currentAbort.abort(); } catch { /* ignore */ }
    currentAbort = null;
  }
  if (audio) {
    audio.pause();
    audio.src = "";
    audio = null;
  }
  if (currentId !== null) {
    currentId = null;
    notify();
  }
}

function playBlob(url: string, token: number, onEnded: () => void): void {
  if (token !== currentToken) return;
  const el = new Audio(url);
  audio = el;
  el.onended = () => {
    if (token !== currentToken) return;
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    onEnded();
  };
  el.onerror = () => {
    if (token !== currentToken) return;
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    onEnded();
  };
  void el.play().catch(() => onEnded());
}

async function playQueue(queue: string[], token: number, done: { value: boolean }): Promise<void> {
  return new Promise<void>((resolve) => {
    const step = () => {
      if (token !== currentToken) { resolve(); return; }
      if (queue.length === 0) {
        if (done.value) { resolve(); return; }
        // Wait for more chunks
        setTimeout(step, 30);
        return;
      }
      const url = queue.shift()!;
      playBlob(url, token, step);
    };
    step();
  });
}

function b64ToBlobUrl(b64: string, mime = "audio/wav"): string {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

async function streamAndPlay(
  backendBase: string,
  text: string,
  id: number,
  token: number,
): Promise<boolean> {
  const abort = new AbortController();
  currentAbort = abort;
  let res: Response;
  try {
    res = await fetch(`${backendBase}/speak_stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ text }),
      signal: abort.signal,
    });
  } catch {
    return false;
  }
  if (!res.ok || !res.body) return false;

  const queue: string[] = [];
  const done = { value: false };
  const playing = playQueue(queue, token, done);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawAudio = false;

  try {
    while (true) {
      if (token !== currentToken) break;
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const obj = JSON.parse(payload);
            if (obj.done) { done.value = true; continue; }
            if (obj.error) { done.value = true; continue; }
            if (obj.audio_b64) {
              queue.push(b64ToBlobUrl(obj.audio_b64));
              sawAudio = true;
              if (currentId !== id) { currentId = id; notify(); }
            }
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    }
  } catch {
    /* stream broken — mark done so playback drains and exits */
  } finally {
    done.value = true;
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  await playing;
  if (token === currentToken) {
    currentId = null;
    notify();
  }
  return sawAudio;
}

async function oneShotFallback(
  backendBase: string,
  text: string,
  id: number,
  token: number,
): Promise<void> {
  try {
    const res = await fetch(`${backendBase}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (token !== currentToken) return;
    const data = (await res.json()) as { audio: string | null };
    if (!data.audio) return;
    const url = b64ToBlobUrl(data.audio);
    currentId = id;
    notify();
    await new Promise<void>((resolve) => playBlob(url, token, resolve));
    if (token === currentToken) { currentId = null; notify(); }
  } catch {
    if (token === currentToken) { currentId = null; notify(); }
  }
}

/** Fetch TTS for `text` and play it, tagged with `id`. Interrupts any current. */
export async function speak(id: number, text: string, backendBase: string): Promise<void> {
  stop();
  const token = ++currentToken;
  currentId = id;
  notify();

  const streamed = await streamAndPlay(backendBase, text, id, token);
  if (!streamed && token === currentToken) {
    await oneShotFallback(backendBase, text, id, token);
  }
}
