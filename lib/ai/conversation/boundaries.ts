/**
 * Frontend-only conversation boundary storage.
 *
 * Since the messages table has no conversation_id column, we maintain a
 * client-side index that maps stable conversation IDs to their exact
 * message timestamp ranges. This lets us reconstruct conversations
 * deterministically across refreshes, instead of relying on a time-gap
 * heuristic that collapses same-day conversations together.
 */

export interface ConversationBoundary {
  id: string;
  startedAt: string | null; // ISO timestamp of first message
  endedAt: string | null; // ISO timestamp of last message
  title: string | null;
}

const STORAGE_PREFIX = "aether_conv_boundaries_";

function getStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function getBoundaries(userId: string): ConversationBoundary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    return raw ? (JSON.parse(raw) as ConversationBoundary[]) : [];
  } catch {
    return [];
  }
}

export function saveBoundaries(
  userId: string,
  boundaries: ConversationBoundary[]
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(boundaries));
  } catch {
    // ignore quota errors
  }
}

export function generateConvId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function startConversation(userId: string): string {
  const id = generateConvId();
  const boundaries = getBoundaries(userId);
  boundaries.unshift({ id, startedAt: null, endedAt: null, title: null });
  saveBoundaries(userId, boundaries);
  return id;
}

export function recordMessage(
  userId: string,
  convId: string,
  timestamp: string,
  isFirstUserMessage: boolean,
  firstUserMessageContent: string
): void {
  const boundaries = getBoundaries(userId);
  const idx = boundaries.findIndex((b) => b.id === convId);
  if (idx === -1) return;

  const b = boundaries[idx];
  if (!b.startedAt) {
    b.startedAt = timestamp;
  }
  b.endedAt = timestamp;
  if (isFirstUserMessage && firstUserMessageContent) {
    b.title = firstUserMessageContent.slice(0, 60);
  }

  // Move to top so most-recently-updated is first
  boundaries.splice(idx, 1);
  boundaries.unshift(b);
  saveBoundaries(userId, boundaries);
}

export function getBoundary(
  userId: string,
  convId: string
): ConversationBoundary | null {
  const boundaries = getBoundaries(userId);
  return boundaries.find((b) => b.id === convId) || null;
}

export function deleteConversation(userId: string, convId: string): void {
  const boundaries = getBoundaries(userId);
  const filtered = boundaries.filter((b) => b.id !== convId);
  saveBoundaries(userId, filtered);
}
