"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ModelInfo } from "@/hooks/useModels";
import type { VoiceStatus } from "@/hooks/useVoice";
import { colors } from "@/lib/tokens";
import ModelSelector from "@/components/ModelSelector";
import EmojiPicker from "@/components/EmojiPicker";
import GifPicker from "@/components/GifPicker";
// Orb removed — voice state is now shown as an inline waveform (see VoiceWaveform below).
import {
  IconArrowUp,
  IconClose,
  IconFile,
  IconGlobe,
  IconImage,
  IconMonitor,
  IconPlus,
  IconSparkles,
  IconStop,
  IconWave,
} from "@/components/icons";
import { brand } from "@/lib/brand";

// The composer is the primary interaction surface. Capability-aware: image/screen
// attachments need a vision model; document upload needs a tool-capable model
// (so the model can retrieve them). No control ever pretends (spec §6/§12/§14/§16).
// Attachments have real lifecycle states (spec §15); while generating, Send becomes
// Stop (spec §5) and the draft is preserved.

interface Attachment {
  id: number;
  file: File;
  url?: string; // data-URL preview, set once decoded
  status: "processing" | "ready" | "failed";
}

interface DocAtt {
  id: number;
  filename: string;
  status: "uploading" | "ready" | "failed";
  docId?: string;
  error?: string;
}

const DOC_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.log,.html,.py,.js,.ts,.tsx,.java,.c,.cpp,.go,.rs,.rb,.php,.sql";

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

async function captureScreenFrame(): Promise<File | null> {
  try {
    const md = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
    };
    if (!md.getDisplayMedia) return null;
    const stream = await md.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 300));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    track.stop();
    return await new Promise((res) =>
      canvas.toBlob((b) => res(b ? new File([b], "screen.png", { type: "image/png" }) : null), "image/png"),
    );
  } catch {
    return null;
  }
}

const LIVE_LABEL: Record<VoiceStatus, string> = {
  idle: "Listening…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: `${brand.name} is speaking — say something to interrupt`,
};

interface Props {
  connected: boolean;
  generating: boolean;
  onStop: () => void;
  models: ModelInfo[];
  active: ModelInfo | null;
  onSelectModel: (id: string) => void;
  onSend: (text: string, web: boolean, gifs?: string[]) => void;
  onSendAttachments: (files: File[], previews: string[], prompt: string) => void;
  onGenerateImage: (prompt: string) => void;
  liveActive: boolean;
  liveStatus: VoiceStatus;
  onToggleLive: () => void;
  liveLevelRef?: MutableRefObject<number>;
}

export default function Composer({
  connected,
  generating,
  onStop,
  models,
  active,
  onSelectModel,
  onSend,
  onSendAttachments,
  onGenerateImage,
  liveActive,
  liveStatus,
  onToggleLive,
  liveLevelRef,
}: Props): JSX.Element {
  const [draft, setDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [webWanted, setWebWanted] = useState(false);
  const [imageMode, setImageMode] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [docs, setDocs] = useState<DocAtt[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifAttachments, setGifAttachments] = useState<{ id: number; url: string; title: string }[]>([]);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const docRef = useRef<HTMLInputElement | null>(null);
  const addRef = useRef<HTMLDivElement | null>(null);
  const emojiRef = useRef<HTMLDivElement | null>(null);
  const gifRef = useRef<HTMLDivElement | null>(null);
  const attachId = useRef(0);
  const docId = useRef(0);
  const gifId = useRef(0);

  // Insert an emoji at the current cursor position of the textarea.
  const insertEmoji = (emoji: string): void => {
    const ta = taRef.current;
    if (!ta) { setDraft((d) => d + emoji); return; }
    const start = ta.selectionStart ?? draft.length;
    const end = ta.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const addGifAttachment = (url: string, title: string): void => {
    setGifAttachments((prev) => [...prev, { id: ++gifId.current, url, title }]);
    setGifOpen(false);
  };
  const removeGifAttachment = (id: number): void => {
    setGifAttachments((prev) => prev.filter((g) => g.id !== id));
  };

  // Close pickers when clicking outside
  useEffect(() => {
    if (!emojiOpen && !gifOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (emojiOpen && emojiRef.current && !emojiRef.current.contains(t)) setEmojiOpen(false);
      if (gifOpen && gifRef.current && !gifRef.current.contains(t)) setGifOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [emojiOpen, gifOpen]);

  const canSee = !!active?.vision;
  const canSearch = !!active?.tools; // tool-capable → can search web AND documents
  const canAttach = canSee || canSearch;
  const webOn = webWanted && canSearch;

  const anyProcessing = attachments.some((a) => a.status === "processing");
  const anyDocUploading = docs.some((d) => d.status === "uploading");
  const readyAtts = attachments.filter((a) => a.status === "ready");
  const hasTray = attachments.length > 0 || docs.length > 0 || gifAttachments.length > 0;

  useEffect(() => {
    if (!addOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addOpen]);

  // Focus the textarea when a home-screen tile is clicked or its shortcut
  // fires. Optional `prefill` populates the textarea (e.g. "What's on my screen?").
  useEffect(() => {
    const onFocus = (e: Event): void => {
      const detail = (e as CustomEvent<{ prefill?: string }>).detail;
      const ta = taRef.current;
      if (detail?.prefill) {
        setDraft(detail.prefill);
      }
      // focus + cursor-to-end on the next tick so the state update has flushed
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
        grow();
      });
    };
    const onEnableWeb = (): void => {
      if (canSearch) setWebWanted(true);
    };
    window.addEventListener("scout:composer-focus", onFocus as EventListener);
    window.addEventListener("scout:enable-web", onEnableWeb as EventListener);
    return () => {
      window.removeEventListener("scout:composer-focus", onFocus as EventListener);
      window.removeEventListener("scout:enable-web", onEnableWeb as EventListener);
    };
  }, [canSearch]);

  function grow(): void {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(190, ta.scrollHeight)}px`;
  }

  // Decode an image file into a preview; status walks processing → ready|failed.
  function addFiles(files: File[]): void {
    if (!canSee) return; // a non-vision model can't use images — stay honest
    const images = files.filter((f) => f.type.startsWith("image/"));
    for (const file of images) {
      const id = ++attachId.current;
      setAttachments((prev) => [...prev, { id, file, status: "processing" }]);
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : undefined;
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, url, status: url ? "ready" : "failed" } : a)),
        );
      };
      reader.onerror = () =>
        setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "failed" } : a)));
      reader.readAsDataURL(file);
    }
  }

  // Upload documents to the RAG store; status walks uploading → ready|failed.
  function addDocs(files: File[]): void {
    const base = backendBase();
    if (!base) return;
    for (const file of files) {
      const id = ++docId.current;
      setDocs((prev) => [...prev, { id, filename: file.name, status: "uploading" }]);
      const form = new FormData();
      form.append("file", file);
      fetch(`${base}/documents`, { method: "POST", body: form })
        .then((r) => r.json())
        .then((d: { ok?: boolean; doc_id?: string; error?: string }) =>
          setDocs((prev) =>
            prev.map((x) =>
              x.id === id
                ? d.ok
                  ? { ...x, status: "ready", docId: d.doc_id }
                  : { ...x, status: "failed", error: d.error }
                : x,
            ),
          ),
        )
        .catch(() =>
          setDocs((prev) => prev.map((x) => (x.id === id ? { ...x, status: "failed", error: "Upload failed" } : x))),
        );
    }
  }

  function removeAttachment(id: number): void {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  // Removing an indexed document deletes it from the store — honest, no orphans.
  function removeDoc(id: number): void {
    const base = backendBase();
    const doc = docs.find((d) => d.id === id);
    if (doc?.docId && base) fetch(`${base}/documents/${doc.docId}`, { method: "DELETE" }).catch(() => {});
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  function submit(): void {
    if (!connected || generating || anyProcessing || anyDocUploading) return;
    const t = draft.trim();
    if (imageMode) {
      if (!t) return;
      onGenerateImage(t);
      setDraft("");
      requestAnimationFrame(grow);
      return;
    }
    if (readyAtts.length > 0) {
      onSendAttachments(
        readyAtts.map((a) => a.file),
        readyAtts.map((a) => a.url as string),
        t,
      );
      setAttachments([]);
      setDraft("");
      requestAnimationFrame(grow);
      return;
    }
    // GIFs (from the picker) get sent as images alongside optional text.
    if (gifAttachments.length > 0) {
      onSend(t, webOn, gifAttachments.map((g) => g.url));
      setGifAttachments([]);
      setDraft("");
      requestAnimationFrame(grow);
      return;
    }
    if (!t) return;
    onSend(t, webOn);
    setDraft("");
    requestAnimationFrame(grow);
  }

  function onImageFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addFiles(files);
    e.target.value = "";
  }

  function onDocFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length) addDocs(files);
    e.target.value = "";
  }

  async function onScreen(): Promise<void> {
    setAddOpen(false);
    const f = await captureScreenFrame();
    if (f) addFiles([f]);
  }

  function onPaste(e: React.ClipboardEvent): void {
    if (!canSee) return;
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    const images = dropped.filter((x) => x.type.startsWith("image/"));
    const others = dropped.filter((x) => !x.type.startsWith("image/"));
    if (images.length && canSee) addFiles(images);
    if (others.length && canSearch) addDocs(others);
  }

  if (liveActive) {
    return (
      <div className="composer-wrap">
        <div className="live-panel">
          <VoiceWaveform status={liveStatus} levelRef={liveLevelRef} />
          <div className="live-panel-text">
            <span className="live-panel-eyebrow">Talk</span>
            <span className="live-panel-status">{LIVE_LABEL[liveStatus]}</span>
          </div>
          <button className="end-live" onClick={onToggleLive}>End</button>
        </div>
      </div>
    );
  }

  const sendDisabled =
    !connected || anyProcessing || anyDocUploading ||
    (readyAtts.length === 0 && gifAttachments.length === 0 && !draft.trim());

  return (
    <div className="composer-wrap">
      <div
        className="composer"
        onDragOver={(e) => {
          e.preventDefault();
          if (canAttach && !dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={
          dragging
            ? { borderColor: colors.brass, boxShadow: "0 0 0 3px rgba(169,136,91,0.18)" }
            : undefined
        }
      >
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={onImageFile} style={{ display: "none" }} />
        <input ref={docRef} type="file" accept={DOC_ACCEPT} multiple onChange={onDocFile} style={{ display: "none" }} />

        {hasTray ? (
          <div className="attach-tray">
            {attachments.map((a) => (
              <div key={`img-${a.id}`} className={`attach-chip ${a.status}`} title={a.file.name}>
                {a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={a.file.name} />
                ) : (
                  <div className="attach-fallback">
                    <IconImage />
                  </div>
                )}
                {a.status === "processing" ? <span className="attach-spin" /> : null}
                {a.status === "failed" ? <span className="attach-fail">!</span> : null}
                <button className="attach-remove" onClick={() => removeAttachment(a.id)} title="Remove" aria-label="Remove attachment">
                  <IconClose size={12} />
                </button>
              </div>
            ))}
            {gifAttachments.map((g) => (
              <div key={`gif-${g.id}`} className="attach-chip gif ready" title={g.title || "GIF"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.url} alt={g.title || "GIF"} />
                <span className="gif-badge">GIF</span>
                <button className="attach-remove" onClick={() => removeGifAttachment(g.id)} title="Remove GIF" aria-label="Remove GIF">
                  <IconClose size={12} />
                </button>
              </div>
            ))}
            {docs.map((d) => (
              <div key={`doc-${d.id}`} className={`doc-chip ${d.status}`} title={d.error || d.filename}>
                <IconFile size={15} />
                <span className="doc-name">{d.filename}</span>
                {d.status === "uploading" ? <span className="doc-spin" /> : null}
                {d.status === "ready" ? <span className="doc-ok">Indexed</span> : null}
                {d.status === "failed" ? <span className="doc-badfail">Failed</span> : null}
                <button className="doc-remove" onClick={() => removeDoc(d.id)} title="Remove" aria-label="Remove document">
                  <IconClose size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            grow();
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={
            imageMode ? "Describe an image to create…" : connected ? `Message ${brand.name}` : `Connecting to ${brand.name}…`
          }
          disabled={!connected}
        />

        <div className="composer-row">
          {/* Add menu — image/screen need vision, documents need a tool-capable model */}
          <div ref={addRef} style={{ position: "relative" }}>
            <button
              className="ghost"
              onClick={() => (canAttach ? setAddOpen((v) => !v) : undefined)}
              disabled={!canAttach}
              title={canAttach ? "Add image, screen, or document" : "This model can't take attachments — choose another model"}
            >
              <IconPlus />
            </button>
            {addOpen && canAttach ? (
              <div className="popover" style={{ left: 0, width: 210 }}>
                {canSee ? (
                  <>
                    <button className="pop-item" onClick={() => { setAddOpen(false); fileRef.current?.click(); }}>
                      <IconImage />
                      <span style={{ fontSize: 13.5, color: colors.ink }}>Upload image</span>
                    </button>
                    <button className="pop-item" onClick={onScreen}>
                      <IconMonitor />
                      <span style={{ fontSize: 13.5, color: colors.ink }}>Capture screen</span>
                    </button>
                  </>
                ) : null}
                {canSearch ? (
                  <button className="pop-item" onClick={() => { setAddOpen(false); docRef.current?.click(); }}>
                    <IconFile />
                    <span style={{ fontSize: 13.5, color: colors.ink }}>Upload document</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Web Search toggle (spec §12) — gated to tool-capable models */}
          <button
            className={`webtoggle ${webOn ? "on" : ""}`}
            onClick={() => (canSearch ? setWebWanted((v) => !v) : undefined)}
            disabled={!canSearch}
            aria-pressed={webOn}
            title={
              canSearch
                ? webOn
                  ? "Web Search is on — your next message searches the web"
                  : "Turn on Web Search for your next message"
                : "This model can't search the web — choose a tool-capable model"
            }
          >
            <IconGlobe />
            <span>Web</span>
          </button>

          {/* Create image toggle (spec §47) — next prompt generates an image */}
          <button
            className={`webtoggle imgtoggle ${imageMode ? "on" : ""}`}
            onClick={() => setImageMode((v) => !v)}
            aria-pressed={imageMode}
            title={imageMode ? "Image mode on — your prompt creates an image" : "Create an image from your prompt"}
          >
            <IconSparkles />
            <span>Image</span>
          </button>

          {/* Emoji picker — insert at cursor */}
          <div ref={emojiRef} style={{ position: "relative" }}>
            <button
              className={`webtoggle emojitoggle ${emojiOpen ? "on" : ""}`}
              onClick={() => { setEmojiOpen((v) => !v); setGifOpen(false); }}
              title="Emoji"
              aria-pressed={emojiOpen}
              type="button"
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>😀</span>
            </button>
            {emojiOpen ? (
              <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
            ) : null}
          </div>

          {/* GIF picker — Giphy */}
          <div ref={gifRef} style={{ position: "relative" }}>
            <button
              className={`webtoggle giftoggle ${gifOpen ? "on" : ""}`}
              onClick={() => { setGifOpen((v) => !v); setEmojiOpen(false); }}
              title="Send a GIF"
              aria-pressed={gifOpen}
              type="button"
            >
              <span style={{ fontWeight: 700, letterSpacing: "0.02em" }}>GIF</span>
            </button>
            {gifOpen ? (
              <GifPicker onPick={addGifAttachment} onClose={() => setGifOpen(false)} />
            ) : null}
          </div>

          <ModelSelector models={models} active={active} onSelect={onSelectModel} />

          <div className="composer-spacer" />

          <button className="livelink" onClick={onToggleLive} title={`Talk with ${brand.name}`}>
            <span className="dot" />
            <IconWave />
            Talk
          </button>

          {generating ? (
            <button className="send stop" onClick={onStop} title="Stop generating">
              <IconStop />
            </button>
          ) : (
            <button className="send" onClick={submit} disabled={sendDisabled} title="Send">
              <IconArrowUp />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Minimal voice-state waveform — 5 vertical bars that react to mic level.
 *  Not a giant orb, just an inline glyph. Idle = still. Listening/speaking =
 *  bars breathe with the sample amplitude in ``levelRef`` (0..1). */
function VoiceWaveform({
  status,
  levelRef,
}: {
  status: VoiceStatus;
  levelRef?: React.MutableRefObject<number>;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const bars = ref.current?.querySelectorAll<HTMLSpanElement>(".vw-bar");
    if (!bars) return;
    const N = bars.length;
    const phase = Array.from({ length: N }, (_, i) => i * 0.9);
    const draw = () => {
      const t = performance.now() / 1000;
      const level = levelRef ? Math.max(0, Math.min(1, levelRef.current)) : 0;
      const base = status === "idle" ? 0.14 : 0.32;
      bars.forEach((b, i) => {
        const wave = 0.5 + 0.5 * Math.sin(t * 4.2 + phase[i]);
        const h = base + wave * 0.55 * (status === "speaking" ? 1 : 0.75) + level * 0.4;
        b.style.transform = `scaleY(${Math.min(1, h).toFixed(3)})`;
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [status, levelRef]);
  return (
    <div ref={ref} className={`voice-wave voice-wave-${status}`} aria-hidden>
      <span className="vw-bar" /><span className="vw-bar" /><span className="vw-bar" />
      <span className="vw-bar" /><span className="vw-bar" />
    </div>
  );
}
