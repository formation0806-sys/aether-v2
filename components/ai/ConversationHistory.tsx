"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type HistorySession = {
  key: string;
  title: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  dayLabel: string;
};

const MAX_SESSIONS_SHOWN = 8;
const UNTITLED = "Conversation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deriveTitle(content: string): string {
  const text = (content ?? "").trim().replace(/\s+/g, " ");
  if (!text) return UNTITLED;
  return text.length > 46 ? `${text.slice(0, 46)}…` : text;
}

/**
 * Enumerates real conversations from the database by distinct `session_id`.
 * Legacy messages (session_id IS NULL) are grouped by a 3-hour time-gap
 * heuristic ONLY for that legacy bucket — they never merge into conversations
 * that have a real session_id, and they never merge into each other across
 * the gap threshold.
 */
function groupBySessionId(
  rows: {
    role: string;
    content: string | null;
    session_id: string | null;
    created_at: string;
  }[]
): HistorySession[] {
  const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

  const sessions: HistorySession[] = [];
  const byKey = new Map<string, HistorySession>();

  const ensure = (key: string, startedAt: string): HistorySession => {
    let s = byKey.get(key);
    if (!s) {
      s = {
        key,
        title: UNTITLED,
        startedAt,
        endedAt: startedAt,
        messageCount: 0,
        dayLabel: "",
      };
      byKey.set(key, s);
      sessions.push(s);
    }
    return s;
  };

  // First pass: real conversations (session_id IS NOT NULL).
  for (const row of rows) {
    if (!row.session_id) continue;
    const key = row.session_id;
    const iso = row.created_at;
    const session = ensure(key, iso);
    if (row.role === "user" && session.title === UNTITLED) {
      const t = deriveTitle(row.content ?? "");
      if (t !== UNTITLED) session.title = t;
    }
    session.endedAt = iso;
    session.messageCount += 1;
  }

  // Second pass: legacy bucket (session_id IS NULL), grouped by 3h gap.
  // We sort these ascending so the gap-walk is correct.
  const legacy = rows
    .filter((r) => !r.session_id)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  let legacyGroup: HistorySession | null = null;
  let previousTime: number | null = null;
  let legacyIdx = 0;
  for (const row of legacy) {
    const time = new Date(row.created_at).getTime();
    if (
      legacyGroup === null ||
      previousTime === null ||
      time - previousTime > SESSION_GAP_MS
    ) {
      const key = `legacy-${row.created_at}-${legacyIdx++}`;
      legacyGroup = ensure(key, row.created_at);
    }
    if (row.role === "user" && legacyGroup.title === UNTITLED) {
      const t = deriveTitle(row.content ?? "");
      if (t !== UNTITLED) legacyGroup.title = t;
    }
    legacyGroup.endedAt = row.created_at;
    legacyGroup.messageCount += 1;
    previousTime = time;
  }

  return sessions;
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const startOfDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
  const diffDays = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ConversationHistory({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const [sessions, setSessions] = useState<HistorySession[] | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeC = pathname === "/chat" ? searchParams.get("c") : null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setSessions([]);
          return;
        }

        // Pull enough rows to populate the sidebar. New conversations are
        // tagged with their session_id, so grouping by session_id gives us
        // a deterministic enumeration regardless of how close in time they
        // were created.
        const { data } = await supabase
          .from("messages")
          .select("role,content,session_id,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(500);

        if (cancelled) return;

        const rows = (data ?? []).slice().reverse();
        const groups = groupBySessionId(rows);

        if (!cancelled) {
          setSessions(
            groups
              .filter((group) => group.messageCount > 0)
              .sort(
                (a, b) =>
                  new Date(b.startedAt).getTime() -
                  new Date(a.startedAt).getTime()
              )
              .slice(0, MAX_SESSIONS_SHOWN)
              .map((group) => ({
                ...group,
                dayLabel: formatDayLabel(group.startedAt),
              }))
          );
        }
      } catch {
        if (!cancelled) setSessions([]);
      }
    }

    load();

    const handler = () => {
      if (!cancelled) load();
    };
    window.addEventListener("aether:conversations-changed", handler);

    return () => {
      cancelled = true;
      window.removeEventListener("aether:conversations-changed", handler);
    };
  }, [pathname, activeC]);

  const linkBase =
    "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-smooth";
  const idleLink = `${linkBase} text-[var(--sidebar-foreground)]/75 hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)]`;
  const activeLink = `${linkBase} bg-[var(--brand)]/10 text-[var(--brand)]`;

  return (
    <div>
      <p className="eyebrow px-3 pb-2 pt-1">Recent</p>
      {sessions === null ? (
        <div className="space-y-0.5 px-1" aria-hidden>
          <div className="h-8 rounded-lg bg-[var(--sidebar-accent)]/60" />
          <div className="h-8 rounded-lg bg-[var(--sidebar-accent)]/60" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="px-3 pb-1 text-xs leading-relaxed text-[var(--sidebar-foreground)]/60">
          No conversations yet. They will appear here as you chat.
        </p>
      ) : (
        <div className="space-y-0.5">
          <Link
            href="/chat"
            onClick={onNavigate}
            className={`flex items-center rounded-lg px-3 py-2 text-sm font-medium text-[var(--brand)] transition-smooth hover:bg-[var(--brand)]/10 ${
              pathname === "/chat" && !activeC ? "bg-[var(--brand)]/10" : ""
            }`}
          >
            + New chat
          </Link>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pb-1">
            {sessions.map((session) => {
              // session.key is either a session_id (uuid) or a synthetic
              // legacy- prefix. Real conversations use ?c=<uuid>; legacy
              // entries open a bare /chat (the user can browse the legacy
              // messages through their existing fallback path).
              const isReal = UUID_RE.test(session.key);
              const hrefString = isReal
                ? `/chat?c=${encodeURIComponent(session.key)}`
                : "/chat";
              return (
                <Link
                  key={session.key}
                  href={hrefString}
                  onClick={(e) => {
                    onNavigate?.();
                  }}
                  className={
                    isReal && activeC === session.key
                      ? activeLink
                      : idleLink
                  }
                  title={session.title}
                >
                  <span className="min-w-0 flex-1 truncate">{session.title}</span>
                  <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">
                    {session.dayLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
