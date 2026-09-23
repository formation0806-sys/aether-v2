/**
 * Agent gate.
 *
 * A pure, deterministic, zero-latency classifier that decides whether a user
 * message is even offered to the agent tools. It answers "agent" only for
 * tool-ish intents:
 *
 *   - time and date questions   (the current_time tool)
 *   - arithmetic expressions    (the calculator tool)
 *   - explicit search requests  (a future web_search tool)
 *   - explicit memory questions (the memory_search tool)
 *
 * Everything else is "chat", which means the existing single-call chat path runs
 * exactly as it does today. The gate never consults feature flags: it only
 * classifies, and the caller decides whether agent mode is enabled at all. This
 * module has no imports, no state, no I/O, and no clock, so a call costs one pass
 * of regular expressions.
 *
 * Precision is deliberately favoured over recall. Missing a tool-ish message
 * costs nothing because the legacy path still answers it, while a false positive
 * changes how a message is served, so the patterns below are narrow and are
 * checked in a fixed order: time, arithmetic, search, memory.
 *
 * General identity questions ("what is my name?") are intentionally left to
 * "chat". The legacy path already answers those from injected retrieval, so
 * offering tools there would add risk without adding value.
 */

/** What the caller should do with a message. */
export type AgentIntent = "agent" | "chat";

/** Which category matched. Used for content-free telemetry. */
export type AgentIntentCategory =
  | "time"
  | "arithmetic"
  | "search"
  | "memory"
  | "none";

/** Messages longer than this are treated as ordinary chat. */
export const MAX_GATE_MESSAGE_LENGTH = 1000;

/** Explicit time and date questions. */
const TIME_PATTERNS: RegExp[] = [
  /\bwhat(?:['\u2019]s| is)\s+the\s+(?:time|date|day)\b/,
  /\bwhat\s+time\s+is\s+it\b/,
  /\bwhat\s+day\s+is\s+(?:it|today)\b/,
  /\bwhat(?:['\u2019]s| is)\s+today['\u2019]s\s+(?:date|day)\b/,
  /\bwhat(?:['\u2019]s| is)\s+the\s+current\s+(?:time|date|day)\b/,
  /\b(?:tell|give)\s+me\s+the\s+(?:time|date|day)\b/,
];

/** Words that frame a message as a computation rather than a statement. */
const COMPUTE_VERB = /\b(?:calculate|compute|evaluate|work\s+out|what\s+is|what['\u2019]s|whats|how\s+much\s+is)\b/;

/** Spelled-out arithmetic: "3 plus 4", "10 divided by 2". */
const WORD_ARITHMETIC = /\b[0-9.]+\s*(?:plus|minus|times|multiplied\s+by|divided\s+by)\s*[0-9.]+/;

/** An operator touching a number on either side: "5-3", "15%", "^2". */
const ARITHMETIC_OPERATOR = /[0-9.]\s*[+\-*/^%]|[+\-*/^%]\s*[0-9.]/;

/** The whole message is nothing but an arithmetic expression: "2+2", "(12+8)/4". */
const BARE_EXPRESSION = /^[0-9.\s()+\-*/^%]+$/;

/** Explicit search requests. */
const SEARCH_PATTERNS: RegExp[] = [
  /\bsearch\s+(?:for|the\s+web|the\s+internet|online)\b/,
  /\b(?:look\s+up|search\s+the\s+web|browse\s+the\s+web)\b/,
  /\bgoogle\s+(?!chrome|analytics|drive|docs|sheets|maps|calendar|cloud|play|meet|workspace)\S/,
];

/** Explicit questions about what is stored in memory. */
const MEMORY_PATTERNS: RegExp[] = [
  /\bwhat\s+do\s+you\s+(?:remember|know)\s+about\b/,
  /\bdo\s+you\s+(?:remember|recall)\b/,
  /\bwhat\s+did\s+i\s+(?:tell|say\s+to)\s+you\b/,
  /\bwhat\s+have\s+i\s+(?:told|said\s+to)\s+you\b/,
  /\bremind\s+me\s+(?:what|that|about|of)\b/,
  /\bwhat\s+do\s+you\s+have\s+(?:stored|saved)\b/,
  /\bsearch\s+your\s+(?:memory|memories)\b/,
];

/** Lowercases and collapses whitespace. Both apostrophe forms are preserved. */
function normalize(message: string): string {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesAny(patterns: RegExp[], message: string): boolean {
  for (const pattern of patterns) {
    if (pattern.test(message)) return true;
  }

  return false;
}

/**
 * Removes date-like tokens so a date is never mistaken for a subtraction. The
 * literals are created per call, which keeps the global flag free of shared
 * lastIndex state.
 */
function stripDateLike(message: string): string {
  return message
    .replace(/\d{4}-\d{1,2}-\d{1,2}/g, " ")
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, " ");
}

function matchesArithmetic(message: string): boolean {
  if (WORD_ARITHMETIC.test(message)) return true;

  const stripped = stripDateLike(message);

  // A bare expression is unambiguous on its own: "2+2", "(12+8)/4".
  if (BARE_EXPRESSION.test(stripped.trim()) && ARITHMETIC_OPERATOR.test(stripped)) {
    return true;
  }

  // Otherwise the computation must be framed as a question or a request, so
  // statements such as "i paid 5-3 dollars" stay on the chat path.
  if (!COMPUTE_VERB.test(message)) return false;

  return ARITHMETIC_OPERATOR.test(stripped);
}

/**
 * Which category matched, or "none". Categories are checked in a fixed order.
 */
export function classifyIntentCategory(message: string): AgentIntentCategory {
  if (typeof message !== "string") return "none";

  const normalized = normalize(message);

  if (normalized === "") return "none";

  // Fail safe for very long messages: the legacy path handles them as today.
  if (normalized.at(MAX_GATE_MESSAGE_LENGTH) !== undefined) return "none";

  if (matchesAny(TIME_PATTERNS, normalized)) return "time";

  if (matchesArithmetic(normalized)) return "arithmetic";

  if (matchesAny(SEARCH_PATTERNS, normalized)) return "search";

  if (matchesAny(MEMORY_PATTERNS, normalized)) return "memory";

  return "none";
}

/**
 * The gate decision. "agent" means the turn may be offered tools, "chat" means
 * the existing single-call path runs unchanged.
 */
export function classifyIntent(message: string): AgentIntent {
  return classifyIntentCategory(message) === "none" ? "chat" : "agent";
}