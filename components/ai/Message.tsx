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
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
        copied
          ? "text-[#F5F5F5]"
          : "text-[#707070] hover:text-[#F5F5F5]"
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
        <div className="max-w-[85%] rounded-2xl bg-[#141414] px-4 py-2.5 sm:max-w-[75%]">
          <p className="whitespace-pre-wrap text-pretty text-[15px] leading-relaxed text-[#F5F5F5]">
            {content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AetherMark className="size-5 text-[#A0A0A0]" />
          <span className="text-xs font-medium text-[#707070]">Salpa</span>
        </div>
        {!isError && (
          <div className="md:opacity-0 md:group-hover:opacity-100">
            <CopyButton text={content} />
          </div>
        )}
      </div>
      {isError ? (
        <div className="rounded-xl border border-[#2A2A2A] bg-[#0A0A0A] px-4 py-3">
          <p className="text-[14px] leading-relaxed text-[#F5F5F5]">{content}</p>
          {detail && (
            <p className="mt-1.5 text-xs leading-relaxed text-[#A0A0A0]">
              {detail}
            </p>
          )}
          {onRetry && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#202020] bg-[#0A0A0A] px-3 py-1.5 text-xs font-medium text-[#F5F5F5] transition-colors duration-150 hover:border-[#2A2A2A]"
              >
                <RefreshCw size={12} aria-hidden />
                Try again
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-[15px] leading-[1.75] text-[#F5F5F5]">
          <Markdown content={content} />
        </div>
      )}
    </div>
  );
}