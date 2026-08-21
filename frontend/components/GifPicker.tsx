"use client";

// ═══════════════════════════════════════════════════════════════════════════
// GifPicker — search + grid, powered by Tenor v2 via backend /gif/search.
// Debounced search input; masonry-ish grid; click a GIF → onPick(url).
// Falls back to a friendly setup message when TENOR_API_KEY isn't set.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";

interface GifItem { url: string; preview: string; title: string; width: number; height: number; }

function backendBase(): string | null {
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT;
  if (typeof window === "undefined" || !port) return null;
  return `http://${window.location.hostname}:${port}`;
}

const TRENDING = ["reaction", "yes", "no", "wow", "lol", "thumbs up", "thinking", "party"];

export default function GifPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string, title: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState<string>("");
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [configured, setConfigured] = useState<boolean>(true);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = (q: string): void => {
    const base = backendBase();
    if (!base) { setError("Backend not reachable."); return; }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    const url = q.trim()
      ? `${base}/gif/search?q=${encodeURIComponent(q.trim())}&limit=24`
      : `${base}/gif/trending?limit=24`;
    fetch(url, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: { gifs?: GifItem[]; configured?: boolean; error?: string }) => {
        if (d.configured === false) {
          setConfigured(false);
          setError(d.error || "GIFs need a TENOR_API_KEY in .env — see docs.");
          setGifs([]);
          return;
        }
        setConfigured(true);
        setGifs(d.gifs ?? []);
        if (!d.gifs?.length) setError(`No results for "${q}".`);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(`Search failed: ${e.message}`);
      })
      .finally(() => setLoading(false));
  };

  // Load trending on open, debounce user queries.
  useEffect(() => {
    const t = window.setTimeout(() => runSearch(query), query ? 250 : 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="gif-pop" onClick={(e) => e.stopPropagation()}>
      <input
        className="gif-search"
        placeholder="Search Tenor GIFs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {!configured && (
        <div className="gif-setup">
          <div className="gif-setup-title">GIFs need one setup step</div>
          <p className="gif-setup-body">
            Add <code>TENOR_API_KEY=…</code> to your <code>.env</code>. Get a free
            key at <a href="https://developers.google.com/tenor/guides/quickstart" target="_blank" rel="noopener noreferrer">
            Tenor / Google Cloud</a>. Restart the backend and you&apos;re set.
          </p>
        </div>
      )}
      {configured && !gifs.length && !loading && !error && (
        <div className="gif-hints">
          {TRENDING.map((t) => (
            <button key={t} className="gif-hint" onClick={() => setQuery(t)}>{t}</button>
          ))}
        </div>
      )}
      {loading && <div className="gif-loading">Searching…</div>}
      {error && configured && <div className="gif-empty">{error}</div>}
      {gifs.length > 0 && (
        <div className="gif-grid">
          {gifs.map((g, i) => (
            <button
              key={`${g.url}-${i}`}
              className="gif-cell"
              style={{ aspectRatio: `${g.width || 1} / ${g.height || 1}` }}
              onClick={() => { onPick(g.url, g.title); }}
              title={g.title}
              type="button"
            >
              <img src={g.preview || g.url} alt={g.title} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
