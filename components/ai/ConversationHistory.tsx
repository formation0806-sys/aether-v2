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

/**
 * Sidebar conversation history.
 *
 * LIMITATION (reported): the current database model has no conversation
 * entity — `messages` only carries (user_id, role, content, created_at) — so
 * sessions are derived from the user's REAL message history using a time-gap
 * heuristic and titles come from each session's first real user message.
 * Nothing is fabricated. A dedicated conversation entity (migration) remains
 * the proper long-term fix and is awaiting authorization.
 */
const SESSION_GAP_MS = 3 * 60 * 60 * 1000;
const MAX_MESSAGES_SCANNED = 200;
const MAX_SESSIONS_SHOWN = 8;
const UNTITLED = "Conversation";

/**
 * Normalizes a Supabase timestamptz string to a UTC ISO string.
 *
 * Supabase may return timestamps without an explicit timezone suffix
 * (e.g. "2026-09-05T06:23:19.408236"). JavaScript's Date constructor
 * parses such strings as LOCAL time, which causes a timezone offset
 * error when later converted to UTC via toISOString().
 *
 * This function detects the missing suffix and appends "Z" to force
 * UTC parsing, ensuring the resulting ISO string represents the same
 * instant as the database value.
 */
function normalizeToUtcIso(timestamp: string): string {
  const trimmed = timestamp.trim();
  // Already has timezone info (Z or ±HH:MM) — parse directly
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed).toISOString();
  }
  // No timezone suffix — append Z to force UTC interpretation
  return new Date(trimmed + "Z").toISOString();
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
  const activeFrom = pathname === "/chat" ? searchParams.get("from") : null;

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

        const { data } = await supabase
          .from("messages")
          .select("role,content,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(MAX_MESSAGES_SCANNED);

        if (cancelled) return;

        const rows = (data ?? []).slice().reverse();
        const groups: HistorySession[] = [];
        let previousTime: number | null = null;

        for (const row of rows) {
          // Normalize to UTC immediately to avoid local-time parsing errors
          const utcIso = normalizeToUtcIso(row.created_at);
          const time = new Date(utcIso).getTime();
          if (previousTime === null || time - previousTime > SESSION_GAP_MS) {
            groups.push({
              key: utcIso,
              title: UNTITLED,
              startedAt: utcIso,
              endedAt: utcIso,
              messageCount: 0,
              dayLabel: "",
            });
          }
          const group = groups[groups.length - 1];
          if (row.role === "user" && group.title === UNTITLED) {
            const text = (row.content ?? "").trim().replace(/\s+/g, " ");
            if (text) {
              group.title = text.length > 46 ? `${text.slice(0, 46)}…` : text;
            }
          }
          group.endedAt = utcIso;
          group.messageCount += 1;
          previousTime = time;
        }

        if (!cancelled) {
          setSessions(
            groups
              .filter((group) => group.messageCount > 0)
              .slice(-MAX_SESSIONS_SHOWN)
              .reverse()
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
    return () => {
      cancelled = true;
    };
  }, []);

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
              pathname === "/chat" && !activeFrom ? "bg-[var(--brand)]/10" : ""
            }`}
          >
            + New chat
          </Link>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pb-1">
            {sessions.map((session) => {
              // session.startedAt and session.endedAt are already normalized UTC ISO strings
              const fromIso = session.startedAt;
              const toTimestamp = new Date(new Date(session.endedAt).getTime() + 5000).toISOString();
              const hrefString = `/chat?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toTimestamp)}`;
              return (
                <Link
                  key={session.key}
                  href={hrefString}
                  onClick={(e) => {
                    onNavigate?.();
                  }}
                  className={
                    activeFrom === fromIso ? activeLink : idleLink
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