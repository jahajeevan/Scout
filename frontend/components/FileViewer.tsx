"use client";

import { useCallback, useEffect, useState } from "react";
import { IconClose } from "@/components/icons";

/**
 * Universal File Viewer — one component, any file, two modes.
 *
 * • ``mode="modal"`` — full-screen overlay for the main chat page.
 * • ``mode="inline"`` — renders inside a parent flex column (no overlay, no
 *   modal chrome). Used by Code mode where the editor pane already exists.
 *
 * Styling uses Scout's CSS variables (--surface, --ink, --hairline, etc.) so
 * both light and dark themes work without inline hex.
 */

type Kind =
  | "pdf" | "image" | "video" | "audio"
  | "text" | "code" | "markdown" | "html" | "csv" | "json"
  | "docx" | "xlsx" | "directory" | "archive" | "unknown" | "missing"
  | "doc-legacy" | "xls-legacy" | "pptx" | "ppt-legacy";

interface Preview {
  kind: Kind;
  name: string;
  path: string;
  size: number;
  mtime: number;
  mime: string;
  exists: boolean;
  ext: string;
  text: string | null;
  html: string | null;
  sheets: { name: string; rows: number; cols: number; values: string[][]; truncated: boolean }[] | null;
  entries: { name: string; is_dir: boolean; size: number; mtime: number; kind: string }[] | null;
  pages: number | null;
  language: string | null;
  truncated: boolean;
  warning: string | null;
}

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Small refresh / back / up / close icons — inline SVG so no new deps. */
const _iconStroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...(_iconStroke as object)}>
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
const BackIcon = () => (<svg width="12" height="12" viewBox="0 0 24 24" {...(_iconStroke as object)}><path d="M15 18l-6-6 6-6"/></svg>);
const UpIcon = () => (<svg width="12" height="12" viewBox="0 0 24 24" {...(_iconStroke as object)}><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>);

export default function FileViewer({
  path: initialPath,
  onClose,
  mode = "modal",
  onOpenPathChange,
}: {
  path: string;
  onClose: () => void;
  mode?: "modal" | "inline";
  /** Called whenever the user navigates within the viewer, so the parent
   * (e.g. Code mode) can keep chat context in sync with the open file. */
  onOpenPathChange?: (path: string) => void;
}): JSX.Element {
  const [path, setPath] = useState(initialPath);
  const [history, setHistory] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [sheetIdx, setSheetIdx] = useState(0);
  const [pathInput, setPathInput] = useState(initialPath);
  const [rawKey, setRawKey] = useState(0); // bump to force iframe/img reload on refresh
  const [pdfPage, setPdfPage] = useState(0);

  const load = useCallback((p: string) => {
    const base = backendBase();
    if (!base) return;
    setLoading(true);
    setErr("");
    setSheetIdx(0);
    setPdfPage(0);
    setPathInput(p);
    fetch(`${base}/preview?path=${encodeURIComponent(p)}&_=${Date.now()}`)
      .then((r) => r.json())
      .then((d: Preview) => setPreview(d))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
    onOpenPathChange?.(p);
  }, [onOpenPathChange]);

  useEffect(() => { load(path); }, [path, load]);

  useEffect(() => { if (initialPath !== path) { setPath(initialPath); setHistory([]); } // parent changed prop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const navigate = (next: string): void => {
    setHistory((h) => [...h, path]);
    setPath(next);
  };
  const goBack = (): void => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setPath(prev);
      return h.slice(0, -1);
    });
  };
  const goUp = (): void => {
    const parent = path.replace(/\/[^/]+\/?$/, "") || "/";
    if (parent !== path) navigate(parent);
  };
  const refresh = (): void => {
    load(path);
    setRawKey((k) => k + 1);
  };

  const rawUrl = (): string => {
    const base = backendBase();
    return base ? `${base}/preview/raw?path=${encodeURIComponent(path)}&_=${rawKey}` : "";
  };

  const renderBody = (): JSX.Element => {
    if (loading) return <div className="fv-empty">Loading…</div>;
    if (err) return <div className="fv-empty fv-err">Error: {err}</div>;
    if (!preview) return <div />;
    if (!preview.exists) return <div className="fv-empty fv-err">File not found.</div>;

    switch (preview.kind) {
      case "pdf": {
        const base = backendBase();
        const total = preview.pages ?? 1;
        const pageUrl = base
          ? `${base}/preview/pdf-page?path=${encodeURIComponent(path)}&page=${pdfPage}&_=${rawKey}`
          : "";
        return (
          <div className="fv-pdf">
            <div className="fv-pdf-toolbar">
              <button
                className="fv-navbtn"
                onClick={() => setPdfPage((p) => Math.max(0, p - 1))}
                disabled={pdfPage <= 0}
              >‹ Prev</button>
              <span className="fv-pdf-count">
                Page <b>{pdfPage + 1}</b> / {total}
              </span>
              <button
                className="fv-navbtn"
                onClick={() => setPdfPage((p) => Math.min(total - 1, p + 1))}
                disabled={pdfPage >= total - 1}
              >Next ›</button>
            </div>
            <div className="fv-pdf-scroll">
              <img key={`${pdfPage}-${rawKey}`} src={pageUrl} alt={`page ${pdfPage + 1}`} className="fv-pdf-page" />
            </div>
          </div>
        );
      }
      case "image":
        return (
          <div className="fv-image-wrap">
            <img key={rawKey} src={rawUrl()} alt={preview.name} className="fv-image" />
          </div>
        );
      case "video":
        return <video key={rawKey} src={rawUrl()} controls className="fv-video" />;
      case "audio":
        return (
          <div className="fv-audio-wrap">
            <audio key={rawKey} src={rawUrl()} controls style={{ width: "100%" }} />
          </div>
        );
      case "text":
      case "code":
      case "html":
      case "json":
      case "csv":
      case "markdown":
        return (
          <pre
            className={`fv-text ${preview.kind === "markdown" || preview.kind === "text" ? "fv-prose" : "fv-mono"}`}
          >
            {preview.text ?? "(empty)"}
          </pre>
        );
      case "docx":
        return preview.html
          ? <div className="fv-docx" dangerouslySetInnerHTML={{ __html: preview.html }} />
          : <div className="fv-empty">{preview.warning ?? "Couldn't render this .docx."}</div>;
      case "xlsx":
        if (!preview.sheets || preview.sheets.length === 0)
          return <div className="fv-empty">{preview.warning ?? "No sheets."}</div>;
        const sheet = preview.sheets[sheetIdx] ?? preview.sheets[0];
        return (
          <div className="fv-xlsx">
            <div className="fv-xlsx-tabs">
              {preview.sheets.map((s, i) => (
                <button
                  key={s.name}
                  onClick={() => setSheetIdx(i)}
                  className={`fv-xlsx-tab ${i === sheetIdx ? "active" : ""}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <div className="fv-xlsx-scroll">
              <table className="fv-xlsx-table">
                <tbody>
                  {sheet.values.map((row, r) => (
                    <tr key={r} className={r === 0 ? "head" : ""}>
                      {row.map((cell, c) => <td key={c}>{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sheet.truncated && <div className="fv-note">Showing first {sheet.rows} rows only.</div>}
          </div>
        );
      case "directory":
        return (
          <div className="fv-dir">
            {(preview.entries ?? []).map((e) => (
              <button
                key={e.name}
                onClick={() => navigate(`${path.replace(/\/$/, "")}/${e.name}`)}
                className="fv-dir-row"
              >
                <span>{e.is_dir ? "📁" : "📄"} {e.name}</span>
                <span className="fv-dir-size">{e.is_dir ? "" : fmtBytes(e.size)}</span>
              </button>
            ))}
            {(preview.entries ?? []).length === 0 && <div className="fv-empty">Empty folder.</div>}
          </div>
        );
      default:
        return (
          <div className="fv-unknown">
            <div style={{ fontSize: 44, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 14 }}>{preview.name}</div>
            <div className="fv-note">{preview.kind} · {fmtBytes(preview.size)} · {preview.mime}</div>
            <div className="fv-note" style={{ marginTop: 8 }}>No inline preview for this type yet.</div>
          </div>
        );
    }
  };

  const chrome = (
    <>
      <header className="fv-head">
        <div className="fv-title">
          <div className="fv-eyebrow">File</div>
          <div className="fv-name">{preview?.name ?? "…"}</div>
          <div className="fv-meta">
            {preview ? (
              <>
                <span>{preview.kind}</span>
                <span className="auto-dot">·</span>
                <span>{fmtBytes(preview.size)}</span>
                {preview.pages ? (
                  <>
                    <span className="auto-dot">·</span>
                    <span>{preview.pages} page{preview.pages === 1 ? "" : "s"}</span>
                  </>
                ) : null}
              </>
            ) : "loading…"}
          </div>
        </div>
        <div className="fv-actions">
          <button className="fv-btn" onClick={refresh} title="Refresh (⌘R)"><RefreshIcon /></button>
          <button className="fv-btn" onClick={onClose} title="Close"><IconClose /></button>
        </div>
      </header>

      <div className="fv-nav">
        <button className="fv-navbtn" onClick={goBack} disabled={history.length === 0} title="Back">
          <BackIcon /> Back
        </button>
        <button className="fv-navbtn" onClick={goUp} title="Parent folder">
          <UpIcon /> Up
        </button>
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pathInput.trim()) {
              e.preventDefault();
              navigate(pathInput.trim());
            }
          }}
          className="fv-path"
          placeholder="/path/to/file  (Enter to open)"
          spellCheck={false}
        />
      </div>

      {preview?.warning && <div className="fv-warn">{preview.warning}</div>}
      {preview?.truncated && !preview.warning && !["pdf","image","video","audio"].includes(preview.kind) && (
        <div className="fv-note fv-note-inline">(Preview truncated — showing the beginning of the file.)</div>
      )}

      <div className="fv-body">{renderBody()}</div>
    </>
  );

  if (mode === "inline") {
    return <div className="fv fv-inline">{chrome}</div>;
  }
  return (
    <div className="fv-scrim" onClick={onClose}>
      <div className="fv fv-modal" onClick={(e) => e.stopPropagation()}>{chrome}</div>
    </div>
  );
}
