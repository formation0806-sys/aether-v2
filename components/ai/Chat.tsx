"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  Brain,
  MemoryStick,
  Plus,
  Send,
  Sparkles,
  Zap,
} from "lucide-react";
import Message from "./Message";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  id?: string;
  error?: boolean;
  detail?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function generateConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (very old browsers). Still globally unique enough for this purpose.
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function WorkspaceHeader({
  memoryCount,
  onNewChat,
}: {
  memoryCount: number;
  onNewChat: () => void;
}) {
  return (
    <div className="hidden shrink-0 items-center gap-3 bg-[var(--background)] px-6 py-2 md:py-3 lg:flex">
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

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-smooth hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        >
          <Plus size={13} className="shrink-0" aria-hidden />
          <span>New chat</span>
        </button>
        {memoryCount > 0 && (
          <Link
            href="/memory"
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--brand)]/25 bg-[var(--brand)]/8 px-3 py-1.5 text-xs font-medium text-[var(--brand)] transition-smooth hover:bg-[var(--brand)]/15"
          >
            <MemoryStick size={13} className="shrink-0" aria-hidden />
            <span>{memoryCount} {memoryCount === 1 ? "context" : "contexts"} remembered</span>
          </Link>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  "Help me plan my week",
  "Analyze an idea",
  "Remember something important",
  "Help me build something",
];

function EmptyState({
  onSuggestion,
}: {
  onSuggestion: (suggestion: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-6">
      <div className="mb-6 max-w-xl text-center sm:mb-10">
        <div className="mx-auto mb-5 inline-flex size-12 items-center justify-center rounded-xl border border-[var(--brand)]/25 bg-[var(--brand)]/10 sm:size-16 sm:rounded-2xl">
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="size-8 text-[var(--brand)] sm:size-10"
            aria-hidden
          >
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
            <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.45" />
            <circle cx="16" cy="16" r="6" fill="currentColor" fillOpacity="0.85" />
            <path d="M12 9L20 17L12 25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--foreground)] sm:text-2xl">
          Your persistent intelligence layer
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)] sm:mt-3 sm:text-[15px]">
          Every conversation builds on the last. Aether extracts, remembers, and
          recalls what matters — carrying context forward automatically.
        </p>
      </div>

      <div className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-center gap-2.5 px-3 py-2 sm:px-4 sm:py-2.5">
          <Sparkles size={14} className="shrink-0 text-[var(--brand)]" aria-hidden />
          <p className="text-xs font-medium text-[var(--muted-foreground)]">What your AI does under the hood</p>
        </div>
        {[
          { icon: Zap, title: "Learn", body: "Extracts facts, preferences, and goals from your conversations." },
          { icon: MemoryStick, title: "Remember", body: "Stores context as durable, retrievable memory." },
          { icon: Brain, title: "Recall", body: "Injects what is relevant into every new response." },
        ].map((cap) => (
          <div key={cap.title} className="hairline-b flex items-start gap-2.5 px-3 py-2.5 last:border-b-0 sm:gap-3 sm:px-4 sm:py-3">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--brand)]/10 sm:size-7 sm:rounded-lg">
              <cap.icon size={13} className="text-[var(--brand)]" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-[var(--foreground)] sm:text-sm">{cap.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">{cap.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex w-full max-w-md flex-wrap items-center justify-center gap-2.5 sm:mt-8">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSuggestion(suggestion)}
            className="min-h-11 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 text-[13px] font-medium text-[var(--muted-foreground)] transition-all duration-150 hover:border-[var(--brand)]/30 hover:bg-[var(--brand)]/8 hover:scale-105 hover:text-[var(--foreground)] sm:py-2 sm:text-xs"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function RefinedComposer({
  value,
  onChange,
  onSend,
  disabled,
  composerRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  disabled?: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
      composerRef.current.style.height = `${composerRef.current.scrollHeight}px`;
    }
  }, [value, composerRef]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    onChange("");
    composerRef.current?.focus();
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
      <div className="mx-auto max-w-[812px] px-4 pb-4 pt-2 md:px-6 app-safe-bottom">
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
            ref={composerRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Ask AETHER…"
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
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl shadow-sm transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed md:size-9 ${
              canSend
                ? "bg-[var(--brand)] text-[var(--brand-foreground)] hover:shadow-md hover:scale-105 active:scale-95"
                : "bg-[var(--brand)]/30 text-[var(--brand-foreground)]/50"
            }`}
          >
            <Send size={15} aria-hidden />
          </button>
        </form>
        <p className="mt-2 hidden text-center text-xs text-[var(--muted-foreground)] md:block">
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
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const lastUserContentRef = useRef<string>("");

  /**
   * Active conversation id (durable). Sources of truth, in priority order:
   *   1. `?c=<uuid>` URL param — survives a hard refresh.
   *   2. localStorage `aether.activeConversation.v1:<userId>` — survives an
   *      F5 even when the URL is bare, so the user keeps their current view.
   *   3. freshly-generated UUID (brand-new conversation).
   */
  const activeConversationIdRef = useRef<string>("");
  const [activeConversationId, setActiveConversationId] = useState<string>("");

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
    setShowScrollHint(distanceFromBottom > 240);
  }

  useEffect(() => {
    if (!followRef.current) return;
    setShowScrollHint(false);
    const frame = requestAnimationFrame(() => scrollToBottom("smooth"));
    return () => cancelAnimationFrame(frame);
  }, [messages, loading, scrollToBottom]);

  const searchParams = useSearchParams();
  const urlConversationId = searchParams.get("c");
  const urlConversationIdStable = urlConversationId ?? "";

  /**
   * On mount: adopt the conversation id from the URL if present. A bare
   * `/chat` URL means "New chat" — we start a fresh conversation and update
   * the URL to its new id so a refresh immediately after restores it.
   */
  useEffect(() => {
    if (isUuid(urlConversationIdStable)) {
      // Always sync the active conversation ID with the URL when they differ.
      // This ensures that navigating to a different conversation via the URL
      // (e.g., clicking a Recent Chat link) updates the active conversation.
      if (activeConversationIdRef.current !== urlConversationIdStable) {
        activeConversationIdRef.current = urlConversationIdStable;
        setActiveConversationId(urlConversationIdStable);
        persistActiveConversation(urlConversationIdStable);
      }
      return;
    }

    // Bare /chat -> mint a fresh conversation id and reflect it in the URL
    // so the new chat becomes refreshable.
    const fresh = generateConversationId();
    activeConversationIdRef.current = fresh;
    setActiveConversationId(fresh);
    persistActiveConversation(fresh);
    router.replace(`/chat?c=${encodeURIComponent(fresh)}`);
  }, [urlConversationIdStable, router]);

  /**
   * History loading. Driven by the active conversation id (URL -> ref).
   * Filters by `session_id` so messages from a sibling conversation on the
   * same day cannot leak in.
   */
  useEffect(() => {
    const convId = activeConversationIdRef.current || urlConversationIdStable;
    if (!isUuid(convId)) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function loadHistory() {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) {
          return;
        }

        const { data, error } = await supabase
          .from("messages")
          .select("role,content,created_at")
          .eq("user_id", user.id)
          .eq("session_id", convId)
          .order("created_at", { ascending: true });

        if (cancelled) {
          return;
        }

        if (error) {
          console.error("History load error:", error);
          return;
        }

        const newMessages: ChatMessage[] = (data ?? []).map((row) => ({
          role: row.role === "user" ? ("user" as const) : ("assistant" as const),
          content: row.content ?? "",
        }));

        setMessages(newMessages);
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
  }, [activeConversationId, urlConversationIdStable, scrollToBottom]);

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

  function handleNewChat() {
    const fresh = generateConversationId();
    activeConversationIdRef.current = fresh;
    setActiveConversationId(fresh);
    persistActiveConversation(fresh);

    followRef.current = true;
    setShowScrollHint(false);
    setDraft("");
    setMessages([]);
    // Notify the sidebar that conversations changed.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("aether:conversations-changed"));
    }
    // Use replace so the browser back-stack does not grow on every New Chat
    // click. The conversation id lives in the URL so a refresh restores B.
    router.replace(`/chat?c=${encodeURIComponent(fresh)}`);
  }

  function handleSuggestion(suggestion: string) {
    setDraft(suggestion);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return;

    // Guarantee we always have a conversation id BEFORE posting so the API
    // can tag both the user message and the assistant message with the SAME
    // id. New Chat -> new id; otherwise reuse the active one.
    let convId = activeConversationIdRef.current;
    if (!isUuid(convId)) {
      convId = generateConversationId();
      activeConversationIdRef.current = convId;
      setActiveConversationId(convId);
    }
    persistActiveConversation(convId);

    followRef.current = true;
    lastUserContentRef.current = content;
    setShowScrollHint(false);

    const userMessage: ChatMessage = { role: "user", content };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setIsThinking(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, conversationId: convId }),
      });

      let payload: { response?: string; error?: string; conversationId?: string };
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok) {
        setIsThinking(false);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Something went wrong while generating this response.",
            detail: typeof payload.error === "string" ? payload.error : undefined,
            error: true,
          },
        ]);
        requestAnimationFrame(() => scrollToBottom("smooth"));
        return;
      }

      const aiContent =
        typeof payload.response === "string"
          ? payload.response
          : "Something went wrong.";

      setIsThinking(false);
      setMessages((prev) => [...prev, { role: "assistant", content: aiContent }]);
      requestAnimationFrame(() => scrollToBottom("smooth"));

      // Mirror the server-canonical id into the URL (if the server echoed
      // one, prefer it) so a manual refresh on this view restores the same
      // conversation deterministically.
      const echoed = typeof payload.conversationId === "string" ? payload.conversationId : null;
      const finalId = echoed && isUuid(echoed) ? echoed : convId;
      if (finalId && urlConversationIdStable !== finalId) {
        router.replace(`/chat?c=${encodeURIComponent(finalId)}`);
      }
      activeConversationIdRef.current = finalId;
      setActiveConversationId(finalId);
      persistActiveConversation(finalId);
    } catch {
      setIsThinking(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Something went wrong. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("aether:conversations-changed"));
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader memoryCount={memoryCount} onNewChat={handleNewChat} />

      {messages.length === 0 ? (
        <EmptyState onSuggestion={handleSuggestion} />
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleMessageScroll}
            className="h-full overflow-y-auto"
          >
          <div className="mx-auto max-w-[768px] space-y-6 px-4 py-4 md:py-6">
            {messages.map((message, index) => (
              <div
                key={`msg-${index}-${message.role}`}
                className="message-enter"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <Message
                  role={message.role}
                  content={message.content}
                  error={message.error}
                  detail={message.detail}
                  onRetry={
                    message.error
                      ? () => sendMessage(lastUserContentRef.current)
                      : undefined
                  }
                />
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

          {showScrollHint && (
            <button
              type="button"
              onClick={() => {
                followRef.current = true;
                setShowScrollHint(false);
                scrollToBottom("smooth");
              }}
              className="scroll-hint-enter absolute bottom-4 right-5 z-10 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] shadow-lg transition-smooth hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              aria-label="Scroll to latest messages"
            >
              <ArrowDown size={13} aria-hidden />
              <span>New messages</span>
            </button>
          )}
        </div>
      )}

<RefinedComposer
        value={draft}
        onChange={setDraft}
        onSend={sendMessage}
        disabled={loading}
        composerRef={composerRef}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* localStorage persistence for the active conversation id                    */
/* -------------------------------------------------------------------------- */

const ACTIVE_CONVERSATION_KEY_PREFIX = "aether.activeConversation.v1:";

function persistActiveConversation(convId: string) {
  if (typeof window === "undefined") return;
  try {
    // Per-user lookup is async; we key by a session-stable id when possible.
    // The auth user id isn't guaranteed to be in scope here, so we use a
    // single shared slot that any future auth-aware code can re-key if
    // necessary. The URL is the authoritative source; this is just a hint
    // for the rare case where the URL is bare and there is no ?c= yet.
    window.localStorage.setItem(
      `${ACTIVE_CONVERSATION_KEY_PREFIX}default`,
      convId
    );
  } catch {
    // ignore quota errors
  }
}
