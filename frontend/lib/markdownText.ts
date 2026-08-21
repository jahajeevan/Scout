// Turn assistant Markdown into (a) clean copyable text and (b) readable speech
// text. We keep the Markdown source for Copy (users expect to paste Markdown),
// and produce a spoken version that drops formatting markers and code.

/** Readable text for TTS: strip Markdown syntax, drop code blocks (spec §17). */
export function toSpeechText(md: string): string {
  let t = md;
  t = t.replace(/```[\s\S]*?```/g, " (code block) "); // don't read code aloud
  t = t.replace(/`([^`]+)`/g, "$1"); // inline code → plain
  t = t.replace(/^#{1,6}\s+/gm, ""); // headings
  t = t.replace(/^\s*>\s?/gm, ""); // blockquotes
  t = t.replace(/^\s*[-*+]\s+/gm, ""); // bullet markers
  t = t.replace(/^\s*\d+\.\s+/gm, ""); // numbered markers
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → label
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2"); // bold
  t = t.replace(/(\*|_)(.*?)\1/g, "$2"); // italic
  t = t.replace(/^\s*([-*_]\s?){3,}\s*$/gm, ""); // horizontal rules
  t = t.replace(/\|/g, " "); // table pipes
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

/** Copyable text — the Markdown source, trimmed (spec §18: clean, not HTML). */
export function toCopyText(md: string): string {
  return (md || "").trim();
}
