/**
 * Frontend-only conversation index.
 *
 * The backend `messages` table has NO conversation/session identifier — rows
 * carry only (user_id, role, content, created_at). Until a durable
 * `conversation_id` column exists (requires a migration), a manual "New chat"
 * boundary cannot survive a reload if we rely only on a time-gap heuristic.
 *
 * This module persists the EXACT server-assigned timestamps of each manually
 * started conversation in localStorage, keyed per user, so that:
 *
 *   - a refresh restores the currently opened conversation (stable URL),
 *   - "Recent" shows genuinely separate conversations even when they are
 *     created minutes apart on the same day,
 *   - no backend / database / API change is required.
 *
 * Boundaries are Supabase `created_at` values (server clock), so they are NOT
 * affected by client clock skew.
 *
 * LIMITATION: the index is per browser/device. Conversations started on
 * another device (or after clearing site data) fall back to the timestamp-gap
 * heuristic. A `conversation_id` column (migration) is the durable fix and
 * remains outside this frontend-only scope.
 */

export type LocalConversation = {
  /** UTC ISO timestamp of the first message of this conversation (authoritative boundary). */
  start: string;
  /** Optional short title derived from the first user message. */
  title?: string;
  /** Last updated time (ms epoch) — unused for ordering, kept for future use. */
  updatedAt: number;
};

const KEY_PREFIX = "aether.conversations.v1";

export function conversationsKey(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

/**
 * Normalizes a Supabase timestamptz string to a UTC ISO string.
 *
 * Supabase may return timestamps without an explicit timezone suffix
 * (e.g. "2026-09-05T06:23:19.408236"). JavaScript's Date constructor
 * parses such strings as LOCAL time, which shifts the instant when later
 * converted to UTC via toISOString(). Detect the missing suffix and append
 * "Z" to force UTC parsing so the resulting ISO represents the same instant.
 */
export function normalizeToUtcIso(timestamp: string): string {
  const trimmed = timestamp.trim();
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return new Date(trimmed).toISOString();
  }
  return new Date(trimmed + "Z").toISOString();
}

/** Short readable title from a user message. */
export function deriveTitle(content: string): string {
  const text = (content ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "Conversation";
  return text.length > 46 ? `${text.slice(0, 46)}…` : text;
}

export function readConversations(userId: string): LocalConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(conversationsKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is LocalConversation =>
          !!c &&
          typeof c === "object" &&
          typeof (c as LocalConversation).start === "string"
      )
      .map((c) => ({
        ...c,
        updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
      }))
      .sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
  } catch {
    return [];
  }
}

export function writeConversations(
  userId: string,
  conversations: LocalConversation[]
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      conversationsKey(userId),
      JSON.stringify(conversations)
    );
  } catch {
    // storage unavailable — degrade gracefully (gap heuristic still applies)
  }
}

/**
 * Adds or updates a conversation boundary. Idempotent for the same start.
 * Titles are only set when the existing record has none, so the first
 * capture wins.
 */
export function upsertConversation(
  userId: string,
  conv: { start: string; title?: string }
): void {
  const list = readConversations(userId);
  const existing = list.find((c) => c.start === conv.start);
  if (existing) {
    if (conv.title && !existing.title) {
      existing.title = conv.title;
    }
    existing.updatedAt = Date.now();
    writeConversations(userId, list);
    return;
  }
  list.push({ start: conv.start, title: conv.title, updatedAt: Date.now() });
  writeConversations(userId, list);
}