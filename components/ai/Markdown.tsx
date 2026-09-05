"use client";

import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

type MarkdownProps = {
  content: string;
};

/**
 * Recursively flattens a React node tree into plain text.
 * Used to copy fenced code block contents to the clipboard.
 */
function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function CodeBlock({
  language,
  code,
}: {
  language: string | null;
  code: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    const text = extractText(code);
    if (!text || !navigator.clipboard?.writeText) return;

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {
        // Clipboard unavailable — silently ignore.
      });
  }, [code]);

  return (
    <div className="aether-codeblock">
      <div className="aether-codeblock-bar">
        <span className="aether-codeblock-lang">{language ?? "code"}</span>
        <button
          type="button"
          className="aether-codeblock-copy"
          onClick={handleCopy}
          aria-label={copied ? "Code copied" : "Copy code"}
        >
          {copied ? (
            <Check size={12} aria-hidden />
          ) : (
            <Copy size={12} aria-hidden />
          )}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="aether-codeblock-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (isValidElement(child)) {
      const props = (child.props ?? {}) as {
        className?: string;
        children?: ReactNode;
      };
      const match = /language-([\w+#.-]+)/.exec(props.className ?? "");
      return (
        <CodeBlock
          language={match ? match[1] : null}
          code={props.children ?? ""}
        />
      );
    }
    return <pre className="aether-codeblock-pre">{children}</pre>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="aether-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

/**
 * Renders assistant responses as semantic HTML with Aether's
 * document-grade typography (see `.aether-prose` in globals.css).
 */
function Markdown({ content }: MarkdownProps) {
  return (
    <div className="aether-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);