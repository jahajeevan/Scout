"use client";

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import CodeBlock from "@/components/CodeBlock";

// MODEL OUTPUT → STREAM HANDLER → MARKDOWN PARSER (remark) → AST → SPECIALIZED
// COMPONENTS. JARVIS owns presentation: headings, paragraphs, lists, tables,
// blockquotes, links, inline code, and fenced code become real elements.
//
// Streaming-safe: remark tolerates an unclosed ``` fence (it renders the tail as
// a code block until the closer arrives), so partial output never breaks the UI.
// Memoized so only the streaming message re-parses, not the whole conversation.

function nodeText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  const el = node as { props?: { children?: ReactNode } };
  if (el.props) return nodeText(el.props.children);
  return "";
}

// Semantic detection (deterministic, content-preserving — spec §32/§33). We only
// add presentation classes; we never rewrite the model's words.
const CALLOUT_RE = /^\s*(note|tip|warning|caution|important|key|result)\b\s*[:.—-]?/i;
const CONCLUSION_RE = /^(recommendation|conclusion|summary|verdict|bottom line|the answer|takeaway)s?\b/i;

function calloutType(text: string): string | null {
  const m = CALLOUT_RE.exec(text.trim());
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (w === "warning" || w === "caution") return "warning";
  if (w === "tip") return "tip";
  if (w === "important" || w === "key") return "important";
  if (w === "result") return "result";
  return "note";
}

const components: Components = {
  code({ className, children }) {
    const raw = nodeText(children);
    const langMatch = /language-([\w-]+)/.exec(className || "");
    const isBlock = !!langMatch || raw.includes("\n");
    if (isBlock) {
      return (
        <CodeBlock language={langMatch?.[1] ?? ""} raw={raw.replace(/\n$/, "")}>
          <span className={className}>{children}</span>
        </CodeBlock>
      );
    }
    return <code className="inline-code">{children}</code>;
  },
  // The default wraps block code in <pre>; our CodeBlock supplies its own, so
  // pass pre-children straight through to avoid a doubled <pre>.
  pre({ children }) {
    return <>{children}</>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
  // Blockquotes become semantic callouts when they lead with a keyword
  // (Note/Tip/Warning/…). Otherwise they stay quotes. Content is untouched.
  blockquote({ children }) {
    const type = calloutType(nodeText(children));
    return <blockquote data-callout={type ?? undefined}>{children}</blockquote>;
  },
  h1: heading("h1"),
  h2: heading("h2"),
  h3: heading("h3"),
};

function heading(Tag: "h1" | "h2" | "h3") {
  const H = ({ children }: { children?: ReactNode }): JSX.Element => {
    const cls = CONCLUSION_RE.test(nodeText(children).trim()) ? "md-conclusion" : undefined;
    return <Tag className={cls}>{children}</Tag>;
  };
  H.displayName = `MdHeading_${Tag}`;
  return H;
}

function MarkdownImpl({ content }: { content: string }): JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Re-render only when the text actually changes (streaming updates one message).
const Markdown = memo(MarkdownImpl);
export default Markdown;
