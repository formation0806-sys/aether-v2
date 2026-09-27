"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, Plus, Send } from "lucide-react";
import Message from "./Message";
import SalpaCompanion from "./SalpaCompanion";

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
    <div className="hidden shrink-0 items-center gap-3 border-b border-[#1A1A1A] bg-black px-6 py-2.5 lg:flex">
      <div className="flex items-center gap-2.5">
        <p className="text-sm font-medium leading-tight text-[#F5F5F5]">Chat</p>
        <p className="flex items-center gap-1.5 text-xs text-[#707070]">
          <span className="inline-flex size-1.5 rounded-full bg-[#707070]" aria-hidden />
          {memoryCount > 0
            ? `${memoryCount} ${memoryCount === 1 ? "memory" : "memories"}`
            : "Context-ready"}
        </p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#202020] bg-transparent px-3 py-1.5 text-xs font-medium text-[#A0A0A0] transition-colors duration-150 hover:border-[#2A2A2A] hover:text-[#F5F5F5]"
        >
          <Plus size={13} className="shrink-0" aria-hidden />
          <span>New chat</span>
        </button>
      </div>
    </div>
  );
}

function EmptyState({ salpaState }: { salpaState: "idle" | "typing" | "thinking" | "responding" }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-black px-4 py-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-[#F5F5F5] sm:text-2xl">
        SALPA
      </h1>

      {/* The bust is the presence, not an illustration beside the copy. It is
          sized from the viewport width so it stays large on desktop and scales
          down proportionally on narrow screens without ever overflowing. */}
      <div className="my-7 w-[min(62vw,15rem)] sm:my-9 sm:w-[min(58vw,17rem)] md:w-[min(46vw,20rem)] lg:w-[min(38vw,22rem)]">
        <SalpaCompanion state={salpaState} className="h-auto w-full" />
      </div>

      <p className="text-sm text-[#A0A0A0] sm:text-[15px]">
        A quiet presence that remembers.
      </p>
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
    <div className="bg-black">
      <div className="mx-auto w-full max-w-[768px] px-4 pb-4 pt-2 md:px-6 app-safe-bottom lg:px-6">
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className={`flex items-end gap-2 rounded-3xl border bg-[#0A0A0A] px-4 py-2.5 transition-colors duration-150 ${
            isFocused
              ? "border-[#2A2A2A]"
              : "border-[#202020]"
          }`}
        >
          <textarea
            ref={composerRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Message SALPA..."
            rows={1}
            disabled={disabled}
            aria-label="Message Salpa"
            className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-2 text-[15px] leading-relaxed text-[#F5F5F5] placeholder:text-[#707070] outline-none disabled:opacity-50"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A2A2A] disabled:cursor-not-allowed ${
              canSend
                ? "bg-[#F5F5F5] text-black hover:bg-white"
                : "bg-[#1A1A1A] text-[#707070]"
            }`}
          >
            <Send size={15} aria-hidden />
          </button>
        </form>
        <p className="mt-2 hidden text-center text-xs text-[#707070] md:block">
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
   * Whether the companion should be watching the composer.
   *
   * Derived from the EXISTING `draft` state rather than a second source of
   * truth: `draft.length > 0` means the user has text in the composer, which is
   * the signal that they are typing. The companion drops its gaze the moment the
   * first character lands.
   *
   * `draft` alone is not enough, because it stays non-empty after the user stops
   * typing. A debounce converts "has text" into "is typing RIGHT NOW": the
   * companion looks down as soon as typing starts and drifts back up
   * ~450ms after the last keystroke. This also means the gaze is driven by real
   * state changes only, so it never animates per character.
   */
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Whether the companion should be holding its subtle responding smile.
   *
   * The chat response is non-streaming: the whole reply arrives in a single
   * payload, so `setIsThinking(false)` and `setLoading(false)` run in the same
   * synchronous continuation and React batches them into one render. That meant
   * `responding` was never actually painted - the companion jumped straight from
   * `thinking` to `idle`.
   *
   * This is a deliberate, timed hold instead. `beginResponding()` sets the flag
   * and clears it on a timer ~900ms later, which lands in a SEPARATE task that
   * automatic batching cannot merge, so the smile is genuinely rendered and
   * then eases back to neutral on its own.
   */
  const [isResponding, setIsResponding] = useState(false);
  const respondingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (draft.length > 0) {
      setIsTyping(true);
      return;
    }

    typingTimerRef.current = setTimeout(() => setIsTyping(false), 450);
    return () => {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [draft]);

  // Clear the pending timers on unmount so no state update lands after teardown.
  useEffect(
    () => () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (respondingTimerRef.current) clearTimeout(respondingTimerRef.current);
    },
    []
  );

  /**
   * Companion expression, in strict priority order:
   * TYPING > THINKING > RESPONDING > IDLE.
   *
   * Typing wins because it is the most immediate evidence of where the user's
   * attention is. Everything below it is only observable while no one is typing.
   */
  const salpaState: "idle" | "typing" | "thinking" | "responding" =
    isTyping
      ? "typing"
      : isThinking
        ? "thinking"
        : isResponding
          ? "responding"
          : "idle";

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

  /**
   * Hold the companion's subtle responding smile for ~900ms after a successful
   * reply, then release it back to neutral.
   *
   * Only ever called on the SUCCESS path. A failed request must never show a
   * smile, so the error branch and the catch deliberately do not call this.
   *
   * Any in-flight hold is cleared first, so a second response arriving inside
   * the window restarts the hold cleanly instead of stacking timers.
   */
  function beginResponding() {
    if (respondingTimerRef.current) {
      clearTimeout(respondingTimerRef.current);
      respondingTimerRef.current = null;
    }

    setIsResponding(true);
    respondingTimerRef.current = setTimeout(() => {
      setIsResponding(false);
      respondingTimerRef.current = null;
    }, 900);
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
      beginResponding();
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
    <div className="flex h-full flex-col bg-black lg:h-full">
      <WorkspaceHeader memoryCount={memoryCount} onNewChat={handleNewChat} />

      {messages.length === 0 ? (
        <EmptyState salpaState={salpaState} />
      ) : (
        <>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <div
            ref={scrollRef}
            onScroll={handleMessageScroll}
            className="h-full overflow-y-auto"
          >
          <div className="mx-auto max-w-[768px] space-y-6 px-4 py-6 lg:px-6">
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
              className="scroll-hint-enter absolute bottom-4 right-5 z-10 inline-flex items-center gap-1.5 rounded-full border border-[#202020] bg-[#0A0A0A] px-3 py-1.5 text-xs font-medium text-[#A0A0A0] transition-colors duration-150 hover:text-[#F5F5F5]"
              aria-label="Scroll to latest messages"
            >
              <ArrowDown size={13} aria-hidden />
              <span>New messages</span>
            </button>
          )}
        </div>

        {/* Persistent companion slot.
            It lives OUTSIDE the scrolling transcript and directly above the
            composer, so its vertical position is anchored to the composer
            instead of to the flow of messages. Appending an assistant message
            can therefore no longer push the figure downward - the jump was
            caused by the companion being the last child of the message stack.
            Being persistent also means the slot has a constant height, so the
            conversation area never resizes between idle/typing/thinking/
            responding, and the neutral face stays on screen after responding
            ends instead of being unmounted.
            The live region is always mounted so state changes are announced
            reliably, but it renders no text at idle - so mounting the slot and
            the return to idle stay silent while "Thinking…"/"Responding…" are
            still announced. */}
        <div className="bg-black">
          <div className="mx-auto w-full max-w-[768px] px-4 pt-2 lg:px-6">
            <div
              className="flex items-center gap-3"
              role="status"
              aria-live="polite"
            >
              <SalpaCompanion state={salpaState} className="size-16 shrink-0" />
              {(salpaState === "thinking" || salpaState === "responding") && (
                <span className="text-xs font-medium text-[#707070]">
                  {salpaState === "thinking" ? "Thinking…" : "Responding…"}
                </span>
              )}
            </div>
          </div>
        </div>
        </>
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
