"use client";

import { useState } from "react";
import type { ReactNode } from "react";

// A fenced code block as a real UI component: language label + copy button with
// copied state, horizontal scroll, restrained warm surface (no neon, no glow).
// Syntax highlighting comes from rehype-highlight (hljs token classes); the
// theme is defined in globals.css to match JARVIS's graphite/brass identity.

interface Props {
  language: string;
  raw: string;
  children: ReactNode;
}

export default function CodeBlock({ language, raw, children }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(raw).then(done).catch(() => {});
    } else {
      done();
    }
  };

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang mono">{language || "text"}</span>
        <button className="codeblock-copy" onClick={copy} aria-label="Copy code">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="codeblock-pre">
        <code>{children}</code>
      </pre>
    </div>
  );
}
