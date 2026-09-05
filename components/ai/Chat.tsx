"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Send, MemoryStick, Zap, Brain, Sparkles } from "lucide-react";
import Message from "./Message";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  id?: string;
};

function WorkspaceHeader({ memoryCount }: { memoryCount: number }) {
  return (
    <div className="flex shrink-0 items-center gap-3 bg-[var(--background)] px-6 py-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[var(--brand)]/20 bg-[var(--brand)]/10">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="size-5 text-[var(--brand)]"
            aria-hidden
          >
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" />
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.55" />
            <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.9" />
            <circle cx="16" cy="16" r="2.6" fill="currentColor" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium leading-tight text-[var(--foreground)]">Workspace</p>
          <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <span className="inline-flex size-1.5 rounded-full bg-emerald-400" aria-hidden />
            Context-ready
          </p>
        </div>
      </div>

      {memoryCount > 0 && (
        <Link
          href="/memory"
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-[var(--brand)]/25 bg-[var(--brand)]/8 px-3 py-1.5 text-xs font-medium text-[var(--brand)] transition-smooth hover:bg-[var(--brand)]/15"
        >
          <MemoryStick size={13} className="shrink-0" aria-hidden />
          <span>{memoryCount} {memoryCount === 1 ? "context" : "contexts"} remembered</span>
        </Link>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="mb-8 max-w-xl text-center">
        <div className="mx-auto mb-6 inline-flex size-16 items-center justify-center rounded-2xl border border-[var(--brand)]/25 bg-[var(--brand)]/10">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="size-10 text-[var(--brand)]"
            aria-hidden
          >
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45" />
            <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.85" />
            <path d="M12 9L20 17L12 25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Your persistent intelligence layer
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-[var(--muted-foreground)]">
          Every conversation builds on the last. Aether extracts, remembers, and
          recalls what matters — carrying context forward automatically.
        </p>
      </div>

      <div className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center gap-2.5 px-4 py-2.5">
          <Sparkles size={14} className="shrink-0 text-[var(--brand)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--muted-foreground)]">What your AI does under the hood</p>
        </div>
        {[
          { icon: Zap, title: "Learn", body: "Extracts facts, preferences, and goals from your conversations." },
          { icon: MemoryStick, title: "Remember", body: "Stores context as durable, retrievable memory." },
          { icon: Brain, title: "Recall", body: "Injects what is relevant into every new response." },
        ].map((cap) => (
          <div key={cap.title} className="hairline-b flex items-start gap-3 px-4 py-3 last:border-b-0">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10">
              <cap.icon size={13} className="text-[var(--brand)]" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--foreground)]">{cap.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">{cap.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RefinedComposer({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
    }
  }

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="bg-[var(--background)]">
      <div className="mx-auto max-w-[812px] px-4 pb-4 pt-2 md:px-6">
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className={`group relative flex items-end gap-2.5 rounded-2xl border bg-[var(--card)] px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_12px_32px_-16px_rgba(0,0,0,0.5)] transition-all duration-200 ${
            isFocused
              ? "border-[var(--ring)] ring-2 ring-[var(--ring)]/25"
              : "border-[var(--border)]"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Ask your AI…"
            rows={1}
            disabled={disabled}
            aria-label="Message Aether"
            className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-2 text-[15px] leading-relaxed text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]/70 outline-none transition-opacity duration-200 disabled:opacity-50"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className={`flex size-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed ${
              canSend
                ? "bg-[var(--brand)] text-[var(--brand-foreground)] hover:shadow-md hover:scale-105 active:scale-95"
                : "bg-[var(--brand)]/30 text-[var(--brand-foreground)]/50"
            }`}
          >
            <Send size={15} aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-[var(--muted-foreground)]">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  /**
   * Auto-follow behaviour for the message area.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  function handleMessageScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    followRef.current = distanceFromBottom < 120;
  }

  useEffect(() => {
    if (!followRef.current) return;
    const frame = requestAnimationFrame(() => scrollToBottom("smooth"));
    return () => cancelAnimationFrame(frame);
  }, [messages, loading, scrollToBottom]);

  /**
   * History loading - loads messages for a time-window session.
   */
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const fromParamStable = fromParam ?? "";
  const toParamStable = toParam ?? "";

  useEffect(() => {
    if (!fromParam) {
      setMessages([]);
      setIsLoaded(false);
      return;
    }

    let cancelled = false;
    const effectFromParam = fromParam;
    const effectToParam = toParam;

    async function loadHistory() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) {
          return;
        }

        let fromTs = effectFromParam;
        let toTs = effectToParam;
        if (fromTs && toTs) {
          const fromMs = new Date(fromTs).getTime();
          const toMs = new Date(toTs).getTime();
          if (fromMs > toMs) {
            [fromTs, toTs] = [toTs, fromTs];
          }
        }

        let query = supabase
          .from("messages")
          .select("role,content,created_at")
          .eq("user_id", user.id)
          .gte("created_at", fromTs)
          .order("created_at", { ascending: true });
        if (toTs) {
          query = query.lte("created_at", toTs);
        }

        const { data, error } = await query;
        if (error) {
          console.error("History query error:", error);
        }

        if (cancelled) {
          return;
        }

        if (error) {
          console.error("History load error:", error);
          return;
        }

        if (!data || data.length === 0) {
          return;
        }

        const newMessages: ChatMessage[] = data.map((row) => ({
          role: row.role === "user" ? ("user" as const) : ("assistant" as const),
          content: row.content ?? "",
        }));

        setMessages(newMessages);
        setIsLoaded(true);
        followRef.current = true;

        requestAnimationFrame(() => scrollToBottom("auto"));
      } catch (err) {
        console.error("History load error:", err);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [fromParamStable, toParamStable, scrollToBottom]);

  useEffect(() => {
    async function fetchMemoryCount() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { count } = await supabase
            .from("memories")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id);
          setMemoryCount(count ?? 0);
        }
      } catch {
        // silently fail
      }
    }
    fetchMemoryCount();
  }, []);

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return;

    followRef.current = true;

    const userMessage: ChatMessage = { role: "user", content };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setIsThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      });

      const data = await response.json();

      let aiContent: string;
      if (response.ok && typeof data.response === "string") {
        aiContent = data.response;
      } else if (typeof data.error === "string") {
        aiContent = `Error: ${data.error}`;
      } else {
        aiContent = "Something went wrong.";
      }

      setIsThinking(false);
      setMessages((prev) => [...prev, { role: "assistant", content: aiContent }]);
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } catch {
      setIsThinking(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader memoryCount={memoryCount} />

      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleMessageScroll}
          className="flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-[768px] space-y-6 px-4 py-6 md:px-6">
            {messages.map((message, index) => (
              <div
                key={`msg-${index}-${message.role}`}
                className="message-enter"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <Message role={message.role} content={message.content} />
              </div>
            ))}
            {loading && (
              <div className="flex items-start gap-3 message-enter" role="status" aria-live="polite">
                <div className="flex size-8 shrink-0 items-center justify-center">
                  <svg
                    viewBox="0 0 32 32"
                    fill="none"
                    className="size-6 text-[var(--brand)] [animation:thinking-pulse_2.4s_ease-in-out_infinite]"
                    aria-hidden
                  >
                    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
                    <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5" />
                    <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.85" />
                    <circle cx="16" cy="16" r="2.5" fill="currentColor" />
                  </svg>
                </div>
                <div className="flex flex-col gap-1 pt-1.5">
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">
                    {isThinking ? "Thinking…" : "Responding…"}
                  </p>
                  <div className="flex gap-1.5 pt-0.5" aria-hidden>
                    <span className="size-1.5 rounded-full bg-[var(--brand)] thinking-dot" style={{ animationDelay: "0ms" }} />
                    <span className="size-1.5 rounded-full bg-[var(--brand)] thinking-dot" style={{ animationDelay: "200ms" }} />
                    <span className="size-1.5 rounded-full bg-[var(--brand)] thinking-dot" style={{ animationDelay: "400ms" }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <RefinedComposer onSend={sendMessage} disabled={loading} />
    </div>
  );
}