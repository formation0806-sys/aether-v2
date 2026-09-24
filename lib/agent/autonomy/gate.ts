/**
 * Long-horizon autonomy gate (Priority L1).
 *
 * A pure, deterministic classifier answering whether a user message is a
 * long-horizon goal worth offering to the autonomy runtime. It reuses the
 * exact planning-intent vocabulary of the AI planner gate (plan, roadmap,
 * milestones, step-by-step, break down, goal tracking phrasing) plus a small
 * set of explicitly long-horizon continuation phrasings (keep working on,
 * pick up where we left off, continue the plan). Everything else is false,
 * so ordinary chat, identity questions, tool-ish single-step requests, and
 * greetings stay on their existing paths.
 *
 * The gate never consults feature flags: it only classifies, and the entry
 * point decides whether autonomy is enabled at all. No imports, no state,
 * no I/O, no clock. Nothing here is imported by production code yet.
 */

/** Messages longer than this are not autonomy requests (fail safe to chat). */
export const MAX_AUTONOMY_MESSAGE_LENGTH = 1000;

/** Explicit multi-step planning intents (mirrors lib/agent/planner/gate.ts). */
const PLANNING_PATTERNS: RegExp[] = [
  /\bplan\b/,
  /\broadmap\b/,
  /\bmilestones?\b/,
  /\bstep\s*by\s*step\b/,
  /\bbreak\s+(it\s+)?down\b/,
  /\bmy\s+goal\s+is\b/,
  /\bhelp\s+me\s+(achieve|reach|plan|organize|organise)\b/,
  /\bcreate\s+a\s+plan\b/,
  /\bmake\s+a\s+plan\b/,
];

/** Explicit long-horizon continuation phrasing. */
const CONTINUATION_PATTERNS: RegExp[] = [
  /\bkeep\s+working\s+on\b/,
  /\bpick\s+up\s+where\s+we\s+left\s+off\b/,
  /\bcontinue\s+(the\s+plan|working\s+on)\b/,
  /\bover\s+the\s+next\s+(few\s+)?(days|weeks|months)\b/,
  /\blong[-\s]?term\s+goal\b/,
];

/** Lowercases and collapses whitespace. */
function normalize(message: string): string {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when any pattern in the list matches. Never throws. */
function matchesAny(patterns: RegExp[], text: string): boolean {
  for (const pattern of patterns) {
    // Each literal is created once at module load; none carries the global
    // flag, so there is no shared lastIndex state between calls.
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * True only for an explicit long-horizon goal request.
 * Never throws, for any input.
 */
export function isAutonomyRequest(message: unknown): boolean {
  try {
    if (typeof message !== "string") return false;

    const normalized = normalize(message);

    if (normalized === "") return false;

    // Fail safe for very long messages: the existing paths handle them.
    if (normalized.at(MAX_AUTONOMY_MESSAGE_LENGTH) !== undefined) return false;

    if (matchesAny(CONTINUATION_PATTERNS, normalized)) return true;

    return matchesAny(PLANNING_PATTERNS, normalized);
  } catch {
    return false;
  }
}
