/**
 * AI planner request gate (Priority 2).
 *
 * A pure, deterministic classifier answering whether a user message is a
 * long-horizon planning request worth offering to the AI planner. It
 * returns true only for explicit multi-step intents:
 *
 *   - plan, roadmap, milestones, step-by-step, break down
 *   - goal tracking phrasing ("my goal is ...", "help me achieve ...")
 *
 * Everything else is false, so ordinary chat, identity questions, tool-ish
 * single-step requests (time, arithmetic, memory lookup), and greetings
 * stay on their existing paths.
 *
 * The gate never consults feature flags: it only classifies, and the entry
 * point decides whether planning is enabled at all. No imports, no state,
 * no I/O, no clock. Nothing here is imported by production code yet.
 */

/** Messages longer than this are not planning requests (fail safe to chat). */
export const MAX_PLANNER_MESSAGE_LENGTH = 1000;

/** Explicit multi-step planning intents. */
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

/** Lowercases and collapses whitespace. */
function normalize(message: string): string {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * True only for an explicit long-horizon planning request.
 * Never throws, for any input.
 */
export function isPlanningRequest(message: unknown): boolean {
  try {
    if (typeof message !== "string") return false;

    const normalized = normalize(message);

    if (normalized === "") return false;

    // Fail safe for very long messages: the existing paths handle them.
    if (normalized.at(MAX_PLANNER_MESSAGE_LENGTH) !== undefined) return false;

    for (const pattern of PLANNING_PATTERNS) {
      if (pattern.test(normalized)) return true;
    }

    return false;
  } catch {
    return false;
  }
}
