"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useModels } from "@/hooks/useModels";
import ModelSelector from "@/components/ModelSelector";
import Markdown from "@/components/Markdown";
import FileViewer from "@/components/FileViewer";
import { colors } from "@/lib/tokens";
import { brand } from "@/lib/brand";
import ThemeToggle from "@/components/ThemeToggle";

// Non-text file kinds → open in the universal FileViewer modal instead of the raw
// text editor pane (which would dump binary bytes like `%PDF-1.5` gibberish).
const _RICH_EXTS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff",
  "mp4", "webm", "mov", "m4v", "mkv",
  "mp3", "wav", "ogg", "m4a", "flac", "aac",
  "docx", "xlsx", "pptx", "doc", "xls", "ppt",
  "zip", "tar", "gz", "bz2", "7z", "rar",
]);
function _isRich(path: string): boolean {
  const ext = (path.split(".").pop() || "").toLowerCase();
  return _RICH_EXTS.has(ext);
}
import {
  IconArrowUp,
  IconChevron,
  IconChevronRight,
  IconClose,
  IconFile,
  IconFolder,
  IconImage,
  IconMessage,
  IconMonitor,
  IconPin,
  IconPlus,
  IconTrash,
} from "@/components/icons";

const DOC_ACCEPT =
  ".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.log,.html,.py,.js,.ts,.tsx,.java,.c,.cpp,.go,.rs,.rb,.php,.sql";

// Code mode (spec §18–21, §48) — a workspace-first surface. Connect a project,
// browse its tree, read files, and drive the Code agent with PLAN / AUTO / BYPASS.
// Everything runs through the sandboxed backend tools; nothing here touches disk
// directly. Terminal execution is intentionally not here yet (a later pass).

interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: TreeNode[];
}
interface Workspace {
  connected: boolean;
  root: string | null;
  name: string | null;
  tree: TreeNode | null;
}
interface CodeMsg {
  id: number;
  role: "user" | "scout";
  text: string;
  activity?: string[];
  state?: string;
  images?: string[];
}
interface CodeImg {
  id: number;
  file: File;
  url?: string;
  status: "processing" | "ready" | "failed";
}
interface CodeDoc {
  id: number;
  filename: string;
  status: "uploading" | "ready" | "failed";
  docId?: string;
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
interface CodeSession {
  id: string;
  title: string;
  messages: CodeMsg[];
  pinned: boolean;
  updatedAt: number;
}
type Mode = "plan" | "auto" | "bypass";

const SESS_KEY = "scout-code-sessions";

function loadSessions(): CodeSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SESS_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveSessions(list: CodeSession[]): void {
  try {
    localStorage.setItem(SESS_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "plan", label: "Plan", hint: "Propose changes only — nothing is written" },
  { id: "auto", label: "Auto", hint: "Apply create/edit/rename automatically; delete still asks" },
  { id: "bypass", label: "Bypass", hint: "Act without re-asking for low-risk edits; delete still asks" },
];

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

export default function CodePage(): JSX.Element {
  const models = useModels();
  type LeftTab = "files" | "changes" | "terminal" | "tasks";
  const [leftTab, setLeftTab] = useState<LeftTab>("files");
  const [ws, setWs] = useState<Workspace>({ connected: false, root: null, name: null, tree: null });
  const [pathInput, setPathInput] = useState("");
  const [connectError, setConnectError] = useState("");
  const [selected, setSelected] = useState<{ path: string; content: string } | null>(null);
  const [viewerPath, setViewerPath] = useState<string | null>(null);
  // Cached text/HTML of the currently open rich-file preview, so the outer chat
  // ("summarize this", "find bugs") can answer with the file as context.
  const [viewerCtx, setViewerCtx] = useState<{ path: string; name: string; kind: string; text: string } | null>(null);
  const [mode, setMode] = useState<Mode>("plan");
  const [messages, setMessages] = useState<CodeMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [codeImgs, setCodeImgs] = useState<CodeImg[]>([]);
  const [codeDocs, setCodeDocs] = useState<CodeDoc[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const attId = useRef(0);
  const codeFileRef = useRef<HTMLInputElement | null>(null);
  const codeDocRef = useRef<HTMLInputElement | null>(null);
  const attachRef = useRef<HTMLDivElement | null>(null);
  const [wsMenu, setWsMenu] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [sessions, setSessions] = useState<CodeSession[]>([]);
  const [activeSess, setActiveSess] = useState<string>("");
  const [sessMenu, setSessMenu] = useState(false);
  const idRef = useRef(0);
  const convRef = useRef<HTMLDivElement | null>(null);
  const wsMenuRef = useRef<HTMLDivElement | null>(null);
  const sessMenuRef = useRef<HTMLDivElement | null>(null);
  const hydrated = useRef(false);

  // Load saved Code sessions once; start on the most recent (or a fresh one).
  useEffect(() => {
    const list = loadSessions();
    if (list.length > 0) {
      const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
      setSessions(list);
      setActiveSess(sorted[0].id);
      setMessages(sorted[0].messages);
      idRef.current = sorted[0].messages.reduce((n, m) => Math.max(n, m.id), 0);
    } else {
      const s: CodeSession = { id: newId(), title: "New session", messages: [], pinned: false, updatedAt: Date.now() };
      setSessions([s]);
      setActiveSess(s.id);
    }
    hydrated.current = true;
  }, []);

  // Persist the active session whenever its messages change.
  useEffect(() => {
    if (!hydrated.current || !activeSess) return;
    setSessions((prev) => {
      const title = messages.find((m) => m.role === "user")?.text.slice(0, 48) || "New session";
      const next = prev.map((s) => (s.id === activeSess ? { ...s, messages, title, updatedAt: Date.now() } : s));
      saveSessions(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeSess]);

  function newSession(): void {
    const s: CodeSession = { id: newId(), title: "New session", messages: [], pinned: false, updatedAt: Date.now() };
    setSessions((prev) => {
      const next = [s, ...prev];
      saveSessions(next);
      return next;
    });
    setActiveSess(s.id);
    setMessages([]);
    idRef.current = 0;
    setSessMenu(false);
    setSelected(null);
    // A new session asks which project folder to work in (cancel keeps the current one).
    pickFolder();
  }
  function selectSession(id: string): void {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    setActiveSess(id);
    setMessages(s.messages);
    idRef.current = s.messages.reduce((n, m) => Math.max(n, m.id), 0);
    setSessMenu(false);
  }
  function deleteSession(id: string): void {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      if (id === activeSess) {
        if (next.length > 0) {
          const first = [...next].sort((a, b) => b.updatedAt - a.updatedAt)[0];
          setActiveSess(first.id);
          setMessages(first.messages);
        } else {
          const s: CodeSession = { id: newId(), title: "New session", messages: [], pinned: false, updatedAt: Date.now() };
          setActiveSess(s.id);
          setMessages([]);
          saveSessions([s]);
          return [s];
        }
      }
      return next;
    });
  }
  function togglePin(id: string): void {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s));
      saveSessions(next);
      return next;
    });
  }

  useEffect(() => {
    if (!sessMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (sessMenuRef.current && !sessMenuRef.current.contains(e.target as Node)) setSessMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [sessMenu]);

  const activeTitle = sessions.find((s) => s.id === activeSess)?.title || "New session";
  const sortedSessions = [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

  const loadWorkspace = useCallback(async (): Promise<void> => {
    const base = backendBase();
    if (!base) return;
    try {
      const r = await fetch(`${base}/workspace`);
      setWs(await r.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const el = convRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function connect(): Promise<void> {
    const base = backendBase();
    if (!base || !pathInput.trim()) return;
    setConnectError("");
    const r = await fetch(`${base}/workspace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathInput.trim() }),
    });
    const d = await r.json();
    if (!d.ok) {
      setConnectError(d.reason || "Couldn't connect that folder.");
      return;
    }
    setPathInput("");
    await loadWorkspace();
  }

  // Open a native macOS Finder dialog on the backend host and connect the pick.
  async function pickFolder(): Promise<void> {
    const base = backendBase();
    if (!base) return;
    setConnectError("");
    setWsMenu(false);
    try {
      const r = await fetch(`${base}/workspace/pick`, { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setSelected(null);
        await loadWorkspace();
      } else if (!d.cancelled) {
        setConnectError(d.reason || d.error || "Couldn't open the folder chooser.");
      }
    } catch {
      setConnectError("Couldn't reach the folder chooser.");
    }
  }

  async function disconnect(): Promise<void> {
    const base = backendBase();
    if (!base) return;
    setWsMenu(false);
    await fetch(`${base}/workspace/disconnect`, { method: "POST" });
    setSelected(null);
    setMessages([]);
    await loadWorkspace();
  }

  useEffect(() => {
    if (!wsMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) setWsMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [wsMenu]);

  async function openFile(path: string): Promise<void> {
    const base = backendBase();
    if (!base) return;
    // PDFs, images, docx, xlsx, video, audio → route to the universal viewer.
    // Tree paths are workspace-relative — resolve against ws.root for /preview,
    // which needs an absolute filesystem path.
    if (_isRich(path)) {
      const abs = path.startsWith("/") ? path : (ws.root ? `${ws.root.replace(/\/$/, "")}/${path}` : path);
      setViewerPath(abs);
      setSelected(null);
      return;
    }
    setViewerPath(null);
    setViewerCtx(null);
    const r = await fetch(`${base}/workspace/file?path=${encodeURIComponent(path)}`);
    const d = await r.json();
    if (d.ok) setSelected({ path: d.path, content: d.content });
  }

  // Whenever the viewer opens a rich file, fetch its extracted text once so the
  // outer chat can answer questions about it. Falls back to metadata blurb.
  useEffect(() => {
    const base = backendBase();
    if (!base || !viewerPath) { setViewerCtx(null); return; }
    let cancelled = false;
    fetch(`${base}/preview?path=${encodeURIComponent(viewerPath)}`)
      .then((r) => r.json())
      .then((p: { name: string; kind: string; text: string | null; html: string | null; size: number }) => {
        if (cancelled) return;
        const stripped = p.html ? p.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
        const text = (p.text || stripped || `(${p.kind}, ${p.size} bytes — no text extract available)`).slice(0, 40000);
        setViewerCtx({ path: viewerPath, name: p.name, kind: p.kind, text });
      })
      .catch(() => setViewerCtx(null));
    return () => { cancelled = true; };
  }, [viewerPath]);

  // --- Code-mode attachments (images/screens → vision analysis; docs → RAG) ---
  function addCodeImages(files: File[]): void {
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      const id = ++attId.current;
      setCodeImgs((prev) => [...prev, { id, file, status: "processing" }]);
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : undefined;
        setCodeImgs((prev) => prev.map((a) => (a.id === id ? { ...a, url, status: url ? "ready" : "failed" } : a)));
      };
      reader.onerror = () => setCodeImgs((prev) => prev.map((a) => (a.id === id ? { ...a, status: "failed" } : a)));
      reader.readAsDataURL(file);
    }
  }
  function addCodeDocs(files: File[]): void {
    const base = backendBase();
    if (!base) return;
    for (const file of files) {
      const id = ++attId.current;
      setCodeDocs((prev) => [...prev, { id, filename: file.name, status: "uploading" }]);
      const form = new FormData();
      form.append("file", file);
      fetch(`${base}/documents`, { method: "POST", body: form })
        .then((r) => r.json())
        .then((dd: { ok?: boolean; doc_id?: string }) =>
          setCodeDocs((prev) =>
            prev.map((x) => (x.id === id ? (dd.ok ? { ...x, status: "ready", docId: dd.doc_id } : { ...x, status: "failed" }) : x)),
          ),
        )
        .catch(() => setCodeDocs((prev) => prev.map((x) => (x.id === id ? { ...x, status: "failed" } : x))));
    }
  }
  function removeCodeImg(id: number): void {
    setCodeImgs((prev) => prev.filter((a) => a.id !== id));
  }
  function removeCodeDoc(id: number): void {
    const base = backendBase();
    const d = codeDocs.find((x) => x.id === id);
    if (d?.docId && base) fetch(`${base}/documents/${d.docId}`, { method: "DELETE" }).catch(() => {});
    setCodeDocs((prev) => prev.filter((x) => x.id !== id));
  }
  async function captureCodeScreen(): Promise<void> {
    setAttachOpen(false);
    const f = await captureScreenFrame();
    if (f) addCodeImages([f]);
  }

  useEffect(() => {
    if (!attachOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) setAttachOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [attachOpen]);

  const readyImgs = codeImgs.filter((a) => a.status === "ready");
  const attProcessing = codeImgs.some((a) => a.status === "processing") || codeDocs.some((d) => d.status === "uploading");

  /** Proceed from a Plan-mode reply — switch mode + apply the plan above
   *  without forcing the user to re-type. History is already threaded through
   *  the /code request, so "proceed" carries the plan's context. */
  async function proceedFromPlan(nextMode: Mode): Promise<void> {
    if (running) return;
    setMode(nextMode);
    // Give the mode state a tick to settle before submitting.
    setDraft("Proceed with the plan above.");
    await new Promise((r) => setTimeout(r, 40));
    // Delegate to run() which reads current draft + mode.
    await run();
  }

  async function run(): Promise<void> {
    const base = backendBase();
    const objective = draft.trim();
    if (!base || !objective || running || !ws.connected || attProcessing) return;
    const imgs = readyImgs;
    const docs = codeDocs.filter((d) => d.status === "ready");
    const userId = ++idRef.current;
    const scoutId = ++idRef.current;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: objective, images: imgs.map((a) => a.url as string) },
      { id: scoutId, role: "scout", text: "", activity: [] },
    ]);
    setDraft("");
    setCodeImgs([]);
    setCodeDocs([]);
    setRunning(true);
    try {
      let finalObjective = objective;
      // Tool-capable coding models can't see images — analyse them with a vision
      // model first, then hand the analysis to the code agent (spec §35 composable).
      if (imgs.length > 0) {
        const visionModel = models.models.find((m) => m.vision && m.available)?.id;
        const form = new FormData();
        imgs.forEach((a) => form.append("files", a.file));
        form.append(
          "prompt",
          `You are assisting a coding task in the project "${ws.name}". Precisely describe what these image(s)/screenshot(s) show — UI layout, any error messages or stack traces, code, or content — so a coding agent can act on it. The task: ${objective}`,
        );
        if (visionModel) form.append("model", visionModel);
        try {
          const vr = await fetch(`${base}/vision-chat`, { method: "POST", body: form }).then((r) => r.json());
          if (vr.reply) finalObjective = `[Analysis of the attached image(s)]\n${vr.reply}\n\n---\nTask: ${objective}`;
        } catch {
          /* vision failed — proceed with text only */
        }
      }
      if (docs.length > 0) {
        finalObjective += `\n\n(The user uploaded ${docs.length} document(s): ${docs
          .map((d) => d.filename)
          .join(", ")}. Use search_documents to read them if relevant.)`;
      }
      // If a rich file (PDF/docx/xlsx/etc.) is currently open in the viewer,
      // inline its extracted text so questions like "summarize this" have context.
      if (viewerCtx) {
        finalObjective = `[The user has this file open in the viewer: ${viewerCtx.name} (${viewerCtx.kind})]\n\n---\n${viewerCtx.text}\n---\n\n${objective}`;
      }
      const r = await fetch(`${base}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: finalObjective,
          mode,
          // Include prior turns from this session (last 20) so "yes proceed"
          // after switching Plan → Auto knows what plan it's proceeding on.
          history: messages
            .filter((m) => m.text && (m.role === "user" || m.role === "scout"))
            .slice(-20)
            .map((m) => ({ role: m.role === "scout" ? "assistant" : "user", content: m.text })),
        }),
      });
      const d = await r.json();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === scoutId
            ? { ...m, text: d.reply || "(no response)", activity: (d.activity || []).map((a: any) => a.label), state: d.state }
            : m,
        ),
      );
      await loadWorkspace();
      if (selected) await openFile(selected.path);
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === scoutId ? { ...m, text: "Scout couldn't reach the workspace." } : m)));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="code-shell">
      <header className="code-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" className="code-back" title="Back to chat">
            <IconMessage />
            <span>Chat</span>
          </Link>
          <span className="code-title">
            {brand.name} <span style={{ color: colors.brass }}>Code</span>
          </span>
          {ws.connected ? (
            <div ref={wsMenuRef} style={{ position: "relative" }}>
              <button className="code-ws" title={ws.root ?? ""} onClick={() => setWsMenu((v) => !v)}>
                <IconFolder size={14} /> {ws.name}
                <IconChevron size={12} />
              </button>
              {wsMenu ? (
                <div className="popover down" style={{ left: 0, width: 180 }}>
                  <button className="pop-item" onClick={pickFolder}>
                    <IconFolder size={15} />
                    <span style={{ fontSize: 13.5, color: colors.ink }}>Change folder…</span>
                  </button>
                  <button className="pop-item" onClick={disconnect}>
                    <span style={{ fontSize: 13.5, color: colors.red }}>Disconnect</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="mode-seg">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-opt mode-${m.id} ${mode === m.id ? "on" : ""}`}
                onClick={() => setMode(m.id)}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>
          <ModelSelector models={models.models} active={models.active} onSelect={models.select} align="right" down />
          <ThemeToggle />
        </div>
      </header>

      {!ws.connected ? (
        <div className="code-connect">
          <div className="code-connect-card">
            <h2>Connect a project</h2>
            <p>Choose a folder on your Mac. {brand.name} Code can only read and edit inside that folder.</p>
            <button className="code-pick" onClick={pickFolder}>
              <IconFolder size={16} /> Choose folder…
            </button>
            <button className="code-manual-toggle" onClick={() => setManualOpen((v) => !v)}>
              {manualOpen ? "Hide manual path" : "or enter a path manually"}
            </button>
            {manualOpen ? (
              <div className="code-connect-row" style={{ marginTop: 10 }}>
                <input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                  placeholder="/Users/you/projects/my-app"
                  spellCheck={false}
                />
                <button onClick={connect} disabled={!pathInput.trim()}>
                  Connect
                </button>
              </div>
            ) : null}
            {connectError ? <p className="code-err">{connectError}</p> : null}
          </div>
        </div>
      ) : (
        <div className="code-body">
          <aside className="code-tree">
            <div className="code-tabs">
              {(["files","changes","terminal","tasks"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setLeftTab(t)}
                  className={`code-tab ${leftTab === t ? "active" : ""}`}
                >{t}</button>
              ))}
            </div>
            <div className="code-tab-body">
              {leftTab === "files" && (
                ws.tree ? <Tree node={ws.tree} depth={0} onOpen={openFile} selected={selected?.path} rootLabel /> : null
              )}
              {leftTab === "changes" && <ChangesPanel onOpen={openFile} />}
              {leftTab === "terminal" && <TerminalPanel />}
              {leftTab === "tasks" && <TasksPanel />}
            </div>
          </aside>

          <section className="code-viewer">
            {viewerPath ? (
              <FileViewer
                path={viewerPath}
                onClose={() => setViewerPath(null)}
                mode="inline"
              />
            ) : selected ? (
              <>
                <div className="code-viewer-head">
                  <IconFile size={14} /> {selected.path}
                </div>
                <pre className="code-file">{selected.content}</pre>
              </>
            ) : (
              <div className="code-empty">Select a file to view it.</div>
            )}
          </section>

          <section className="code-agent">
            <div className="code-sess-bar">
              <div ref={sessMenuRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
                <button className="code-sess-btn" onClick={() => setSessMenu((v) => !v)} title="Sessions">
                  <IconMessage size={13} />
                  <span className="code-sess-title">{activeTitle}</span>
                  <IconChevron size={12} />
                </button>
                {sessMenu ? (
                  <div className="popover down" style={{ left: 0, width: 300, maxHeight: "60vh", overflowY: "auto" }}>
                    <div className="eyebrow" style={{ padding: "6px 11px 4px" }}>
                      Sessions
                    </div>
                    {sortedSessions.map((s) => (
                      <div key={s.id} className={`sess-row ${s.id === activeSess ? "active" : ""}`}>
                        <button className="sess-open" onClick={() => selectSession(s.id)}>
                          {s.pinned ? <IconPin size={11} /> : null}
                          <span className="sess-name">{s.title}</span>
                        </button>
                        <button className="sess-act" onClick={() => togglePin(s.id)} title={s.pinned ? "Unpin" : "Pin"}>
                          <IconPin size={13} />
                        </button>
                        <button className="sess-act" onClick={() => deleteSession(s.id)} title="Delete">
                          <IconTrash size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <button className="code-newsess" onClick={newSession} title="New session">
                <IconPlus size={15} /> New
              </button>
            </div>
            <div className="code-conv" ref={convRef}>
              {messages.length === 0 ? (
                <div className="code-agent-hint">
                  Ask {brand.name} to build or change something in <b>{ws.name}</b>. Currently in{" "}
                  <b>{MODES.find((m) => m.id === mode)?.label}</b> mode.
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`code-msg ${m.role}`}>
                    {m.role === "scout" && m.activity && m.activity.length > 0 ? (
                      <div className="code-activity">
                        {m.activity.map((a, i) => (
                          <span key={i} className="code-act-line">
                            {a}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {m.images && m.images.length > 0 ? (
                      <div className="code-msg-thumbs">
                        {m.images.map((src, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={src} alt="attachment" className="code-msg-thumb" />
                        ))}
                      </div>
                    ) : null}
                    {m.role === "user" ? (
                      <span>{m.text}</span>
                    ) : m.text ? (
                      <Markdown content={m.text} />
                    ) : (
                      <span className="code-thinking">Working…</span>
                    )}
                    {m.state === "requires_confirmation" ? (
                      <div className="code-pending-block">
                        <span className="code-pending">Awaiting confirmation</span>
                        <div className="code-pending-actions">
                          <button
                            className="code-pending-btn primary"
                            onClick={() => proceedFromPlan("auto")}
                            disabled={running}
                            title="Switch to Auto mode and apply the plan above"
                          >Apply in Auto</button>
                          <button
                            className="code-pending-btn"
                            onClick={() => proceedFromPlan("bypass")}
                            disabled={running}
                            title="Switch to Bypass and apply without further confirmation"
                          >Apply in Bypass</button>
                          <button
                            className="code-pending-btn ghost"
                            onClick={() => setDraft("please refine the plan first")}
                            disabled={running}
                          >Refine plan</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <div className="code-composer">
              <input
                ref={codeFileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? []);
                  if (fs.length) addCodeImages(fs);
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
              <input
                ref={codeDocRef}
                type="file"
                accept={DOC_ACCEPT}
                multiple
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? []);
                  if (fs.length) addCodeDocs(fs);
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />

              {codeImgs.length > 0 || codeDocs.length > 0 ? (
                <div className="attach-tray" style={{ padding: "0 0 10px" }}>
                  {codeImgs.map((a) => (
                    <div key={`i${a.id}`} className={`attach-chip ${a.status}`} title={a.file.name}>
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
                      <button className="attach-remove" onClick={() => removeCodeImg(a.id)} aria-label="Remove">
                        <IconClose size={12} />
                      </button>
                    </div>
                  ))}
                  {codeDocs.map((d) => (
                    <div key={`d${d.id}`} className={`doc-chip ${d.status}`} title={d.filename}>
                      <IconFile size={15} />
                      <span className="doc-name">{d.filename}</span>
                      {d.status === "uploading" ? <span className="doc-spin" /> : null}
                      {d.status === "ready" ? <span className="doc-ok">Indexed</span> : null}
                      {d.status === "failed" ? <span className="doc-badfail">Failed</span> : null}
                      <button className="doc-remove" onClick={() => removeCodeDoc(d.id)} aria-label="Remove">
                        <IconClose size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="code-composer-row">
                <div ref={attachRef} style={{ position: "relative" }}>
                  <button className="code-attach" onClick={() => setAttachOpen((v) => !v)} title="Attach image, screen, or document">
                    <IconPlus />
                  </button>
                  {attachOpen ? (
                    <div className="popover" style={{ left: 0, bottom: "calc(100% + 8px)", width: 210 }}>
                      <button className="pop-item" onClick={() => { setAttachOpen(false); codeFileRef.current?.click(); }}>
                        <IconImage />
                        <span style={{ fontSize: 13.5, color: colors.ink }}>Upload image</span>
                      </button>
                      <button className="pop-item" onClick={captureCodeScreen}>
                        <IconMonitor />
                        <span style={{ fontSize: 13.5, color: colors.ink }}>Capture screen</span>
                      </button>
                      <button className="pop-item" onClick={() => { setAttachOpen(false); codeDocRef.current?.click(); }}>
                        <IconFile />
                        <span style={{ fontSize: 13.5, color: colors.ink }}>Upload document</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      run();
                    }
                  }}
                  rows={2}
                  placeholder={running ? "Working…" : `Tell ${brand.name} Code what to do…`}
                  disabled={running}
                />
                <button className="code-send" onClick={run} disabled={running || attProcessing || !draft.trim()} title="Run">
                  <IconArrowUp />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Tree({
  node,
  depth,
  onOpen,
  selected,
  rootLabel,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (path: string) => void;
  selected?: string;
  rootLabel?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(depth < 1);
  if (!node.is_dir) {
    return (
      <button
        className={`tree-row file ${selected === node.path ? "sel" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onOpen(node.path)}
      >
        <IconFile size={13} />
        <span>{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      <button className="tree-row dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setOpen((v) => !v)}>
        <span className={`tree-caret ${open ? "open" : ""}`}>
          <IconChevronRight size={12} />
        </span>
        <IconFolder size={13} />
        <span>{rootLabel ? node.name : node.name}</span>
      </button>
      {open && node.children
        ? node.children.map((c) => (
            <Tree key={c.path} node={c} depth={depth + 1} onOpen={onOpen} selected={selected} />
          ))
        : null}
    </div>
  );
}

// ═══ Code workspace panels ═══════════════════════════════════════════
// Small helpers used by Changes / Terminal / Tasks tabs.
function _base(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

interface GitFile { path: string; state: string; code: string }

/** Live git status list. Click a file → viewer picks it up; the accent bar +
 *  status chip on the left communicate what changed. */
function ChangesPanel({ onOpen }: { onOpen: (p: string) => void }): JSX.Element {
  const [branch, setBranch] = useState<string>("");
  const [files, setFiles] = useState<GitFile[]>([]);
  const [err, setErr] = useState<string>("");
  const [diff, setDiff] = useState<string>("");
  const [sel, setSel] = useState<string>("");

  const load = useCallback(() => {
    const base = _base(); if (!base) return;
    fetch(`${base}/workspace/git/status`).then((r) => r.json()).then((d: { ok: boolean; branch?: string; files?: GitFile[]; error?: string }) => {
      if (!d.ok) { setErr(d.error ?? "git status failed"); return; }
      setErr(""); setBranch(d.branch ?? ""); setFiles(d.files ?? []);
    }).catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const loadDiff = (p: string): void => {
    setSel(p);
    const base = _base(); if (!base) return;
    fetch(`${base}/workspace/git/diff?path=${encodeURIComponent(p)}`).then((r) => r.json())
      .then((d: { ok: boolean; diff?: string }) => setDiff(d.diff ?? ""))
      .catch(() => setDiff(""));
  };

  if (err) return <div className="cp-empty">{err}</div>;
  return (
    <div className="cp">
      <div className="cp-head">
        <span className="cp-branch mono">{branch || "detached"}</span>
        <button className="cp-refresh" onClick={load} title="Refresh">↻</button>
      </div>
      {files.length === 0 ? (
        <div className="cp-empty">No changes. Working tree clean.</div>
      ) : (
        <div className="cp-list">
          {files.map((f) => (
            <button
              key={f.path}
              className={`cp-row cp-state-${f.state} ${sel === f.path ? "sel" : ""}`}
              onClick={() => loadDiff(f.path)}
              onDoubleClick={() => onOpen(f.path)}
              title="Click for diff · double-click to open"
            >
              <span className="cp-chip">{f.state[0].toUpperCase()}</span>
              <span className="cp-name">{f.path}</span>
            </button>
          ))}
        </div>
      )}
      {sel && (
        <pre className="cp-diff mono">{diff || "(no diff — untracked or binary)"}</pre>
      )}
    </div>
  );
}

interface TermEntry { cmd: string; code: number; output: string; started: string }

/** One-shot terminal — not a live PTY, but a real command runner: input →
 *  POST /workspace/run → append to scrollback. Enter runs; ↑/↓ history. */
function TerminalPanel(): JSX.Element {
  const [entries, setEntries] = useState<TermEntry[]>([]);
  const [input, setInput] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [histIdx, setHistIdx] = useState<number>(-1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    const base = _base(); if (!base) return;
    fetch(`${base}/workspace/terminal`).then((r) => r.json())
      .then((d: { history?: TermEntry[] }) => setEntries(d.history ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries]);

  const run = async (): Promise<void> => {
    const cmd = input.trim(); if (!cmd || running) return;
    setRunning(true); setInput("");
    const base = _base(); if (!base) { setRunning(false); return; }
    try {
      await fetch(`${base}/workspace/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
    } catch { /* logged in history */ }
    setRunning(false);
    setHistIdx(-1);
    load();
  };

  return (
    <div className="term">
      <div ref={scrollRef} className="term-scroll">
        {entries.length === 0 && (
          <div className="cp-empty">
            Run a command in the workspace root. Blocked patterns (rm -rf, sudo…) are refused.
          </div>
        )}
        {[...entries].reverse().map((e, i) => (
          <div key={i} className="term-entry">
            <div className="term-cmd">
              <span className="term-arrow">›</span>
              <span className="mono">{e.cmd}</span>
              <span className={`term-status ${e.code === 0 ? "ok" : "err"}`}>{e.code === 0 ? "ok" : `exit ${e.code}`}</span>
            </div>
            {e.output && <pre className="term-out mono">{e.output}</pre>}
          </div>
        ))}
      </div>
      <div className="term-input-row">
        <span className="term-arrow">›</span>
        <input
          className="term-input mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); run(); }
            else if (e.key === "ArrowUp") {
              e.preventDefault();
              const next = Math.min(histIdx + 1, entries.length - 1);
              if (entries[next]) { setInput(entries[next].cmd); setHistIdx(next); }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const next = Math.max(histIdx - 1, -1);
              setInput(next === -1 ? "" : entries[next]?.cmd ?? "");
              setHistIdx(next);
            }
          }}
          placeholder={running ? "running…" : "e.g. npm run dev · git status · python foo.py"}
          disabled={running}
          spellCheck={false}
          autoFocus
        />
      </div>
    </div>
  );
}

interface Task { kind: string; label: string; ok: boolean; at: string }

/** Tool-execution log — everything Scout did in the workspace this session. */
function TasksPanel(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const load = useCallback(() => {
    const base = _base(); if (!base) return;
    fetch(`${base}/workspace/tasks`).then((r) => r.json())
      .then((d: { tasks?: Task[] }) => setTasks(d.tasks ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (tasks.length === 0) return <div className="cp-empty">No tasks yet. When Scout runs a command or edits a file, it appears here.</div>;
  return (
    <div className="tasks">
      {tasks.map((t, i) => (
        <div key={i} className={`task-row ${t.ok ? "ok" : "err"}`}>
          <span className={`task-dot ${t.ok ? "ok" : "err"}`} />
          <div className="task-main">
            <div className="task-label">{t.label}</div>
            <div className="task-meta mono">{t.kind} · {new Date(t.at).toLocaleTimeString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
