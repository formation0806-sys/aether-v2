import { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import Markdown from "./Markdown";

type MessageProps = {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  detail?: string;
  onRetry?: () => void;
};

function AetherMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" />
      <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.55" />
      <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.9" />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable — silently ignore
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
        copied
          ? "bg-emerald-500/10 text-emerald-500"
          : "text-[var(--muted-foreground)] hover:bg-[var(--foreground)]/5 hover:text-[var(--foreground)]"
      }`}
      aria-label={copied ? "Copied" : "Copy response"}
    >
      {copied ? (
        <>
          <Check size={12} aria-hidden />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy size={12} aria-hidden />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

export default function Message({ role, content, error, detail, onRetry }: MessageProps) {
  const isUser = role === "user";
  const isError = !isUser && error;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-lg bg-[var(--brand)]/[0.07] px-4 py-2.5">
          <p className="whitespace-pre-wrap text-pretty text-[15px] leading-relaxed text-[var(--foreground)]">
            {content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-2 rounded-xl px-3 py-2 -mx-3 transition-colors duration-200 hover:bg-[var(--foreground)]/[0.02]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AetherMark className="size-5 text-[var(--brand)]" />
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Aether</span>
        </div>
        {!isError && (
          <div className="opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0">
            <CopyButton text={content} />
          </div>
        )}
      </div>
      {isError ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3">
          <p className="text-[14px] leading-relaxed text-red-300">{content}</p>
          {detail && (
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              {detail}
            </p>
          )}
          {onRetry && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-smooth hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RefreshCw size={12} aria-hidden />
                Try again
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-[15px] leading-[1.75] text-[var(--foreground)]">
          <Markdown content={content} />
        </div>
      )}
    </div>
  );
}