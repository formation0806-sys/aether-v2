/**
 * Multi-agent orchestration gate (Priority 4).
 *
 * Decides whether a user message is a *multi-part* request worth offering to
 * a future coordinator - work with two or more separable parts whose outputs
 * must later be combined. Pure and deterministic: no runtime imports, no
 * flags, no environment, no clock, no randomness, no model call.
 *
 * The gate is deliberately conservative. It fires only on explicit multi-part
 * phrasing, so ordinary chat, single tool-ish questions ("what time is it",
 * "calculate 2 + 2"), identity facts, and single-goal planning requests stay
 * on their existing paths. Precision over recall: a missed multi-part message
 * costs nothing because the legacy path still answers it, while a false
 * positive would change how a message is served.
 *
 * Reading no flags here is intentional: classification must be independent of
 * ENABLE_MULTI_AGENT so it stays testable and stable while the capability is
 * still switched off. The flag is enforced once, by the entry point.
 */

/** Upper bound on a message this gate will even look at. */
export const MAX_ORCHESTRATION_MESSAGE_CHARS = 1000;

/**
 * Explicit multi-part phrasing: the message names two or more separable
 * pieces of work plus a combine step.
 */
const MULTI_PART_PATTERNS: readonly RegExp[] = [
  /\bcompare\s+\S+\s+and\s+\S+/i,
  /\bpros\s+and\s+cons\b/i,
  /\bresearch\b[\s\S]{0,80}\band\s+then\s+summar/i,
  /\bdo\s+a\s+then\s+b\b/i,
  /\bfirst\b[\s\S]{0,80}\bthen\b[\s\S]{0,80}\bfinally\b/i,
  /\bbreak\s+(?:this|it|that)\s+into\s+parts?\b/i,
  /\b(?:split|divide)\s+(?:this|it|that)\s+into\b/i,
  /\bgather\b[\s\S]{0,80}\bcombine\b/i,
];

/**
 * Hard negatives. Checked first, so a message that merely mentions a
 * multi-part word while asking for something else is never classified as
 * multi-agent work.
 */
const REJECT_PATTERNS: readonly RegExp[] = [
  // Identity facts belong to the identity layer.
  /\bmy name is\b/i,
  // Single tool-shaped requests belong to the agent loop's tools.
  /^\s*(?:what(?:'s| is) the time|what time|calculate|compute|calc|search the web)\b/i,
  // Single-goal planning requests belong to the AI planner.
  /\b(?:make|create|build|give me)\s+(?:me\s+)?a\s+(?:plan|roadmap)\b/i,
  // Bare greetings and thanks are never multi-part work.
  /^\s*(?:hi|hello|hey|thanks|thank you|ok|okay)\b/i,
];

/** True when any pattern in the list matches. Never throws. */
function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * True only when the message explicitly asks for multi-part work.
 *
 * Returns false for non-strings, blank messages, oversized messages, and
 * anything matching a hard negative. Never throws, for any input.
 */
export function isMultiAgentRequest(message: unknown): boolean {
  try {
    if (typeof message !== "string") return false;

    const text = message.trim();

    if (text === "") return false;

    // Reject oversized input rather than truncating: a request described in
    // more than the cap is beyond this gate's remit.
    if (text.at(MAX_ORCHESTRATION_MESSAGE_CHARS) !== undefined) return false;

    if (matchesAny(REJECT_PATTERNS, text)) return false;

    return matchesAny(MULTI_PART_PATTERNS, text);
  } catch {
    return false;
  }
}
