/**
 * Procedural-memory gate (Priority 3).
 *
 * Decides whether a user message describes a *procedure* - and so belongs to
 * procedural memory rather than to the ordinary extraction path, the planner,
 * or the agent loop. Pure and deterministic: no runtime imports, no flags, no
 * environment, no clock, no randomness, no model call. The one import is
 * type-only (erased at runtime).
 *
 * The gate is deliberately conservative. It fires only on explicit procedural
 * phrasing, so ordinary chat ("how are you doing today") can never be turned
 * into a stored procedure, and it rejects anything that clearly belongs to
 * another capability (time, arithmetic, identity) even when a procedural word
 * appears somewhere in the sentence.
 *
 * Reading no flags here is intentional: classification must be independent of
 * ENABLE_PROCEDURAL_MEMORY so it stays testable and stable while the capability
 * is still switched off. The flag is enforced once, by the entry point.
 */

import type { ProceduralKind } from "./types";

/** Upper bound on a message this gate will even look at. */
export const MAX_PROCEDURAL_MESSAGE_CHARS = 1000;

/** Explicit workflow phrasing: an ordered, repeatable process. */
const WORKFLOW_PATTERNS: readonly RegExp[] = [
  /\bmy (?:workflow|process|routine|procedure|checklist|system)\b/i,
  /\b(?:workflow|process|routine|procedure|checklist|playbook|pipeline)\s+(?:for|to|is)\b/i,
  /\bstep[-\s]?by[-\s]?step\b/i,
  /\b(?:steps?|phases?)\s+(?:to|for|i)\b/i,
  /\bthe (?:steps|order|sequence) (?:i|we)\b/i,
];

/** Strategy phrasing: a decision policy for choosing what to do. */
const STRATEGY_PATTERNS: readonly RegExp[] = [
  /\b(?:my|the|our)\s+(?:strategy|approach|playbook|tactic|method|framework)\b/i,
  /\b(?:strategy|approach|playbook|tactic|method|framework)\s+(?:for|to|is)\b/i,
  /\bbest way to\b/i,
  /\bwhen (?:i|we)\b[\s\S]{0,60}\b(?:i|we)\s+(?:do|use|always|usually|never)\b/i,
  /\bhow (?:i|we) (?:decide|choose|pick|approach)\b/i,
];

/** Skill phrasing: a capability the user has or is acquiring. */
const SKILL_PATTERNS: readonly RegExp[] = [
  /\bi (?:know how to|learned how to|learnt how to|am good at|'m good at|am skilled at)\b/i,
  /\bi(?:'ve| have) (?:mastered|perfected|gotten good at)\b/i,
  /\bmy (?:skill|skills|expertise|specialty|speciality|practice)\b/i,
  /\bhow (?:do|should|can) (?:i|we)\b/i,
];

/**
 * Hard negatives. Checked first, so a message that merely mentions a procedure
 * while asking for something else is never classified as procedural.
 */
const REJECT_PATTERNS: readonly RegExp[] = [
  // Identity facts belong to the identity layer.
  /\bmy name is\b/i,
  // Tool-shaped requests belong to the agent loop's tools.
  /^\s*(?:what(?:'s| is) the time|what time|calculate|compute|calc|search the web)\b/i,
  // Explicit planning requests belong to the AI planner.
  /\b(?:make|create|build|give me)\s+(?:me\s+)?a\s+(?:plan|roadmap)\b/i,
  /\bbreak (?:this|it) down into (?:steps|milestones|phases)\b/i,
];

/** True when any pattern in the list matches. Never throws. */
function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * Classifies a message by procedural kind, or returns null when it does not
 * describe a procedure at all.
 *
 * Returns null for non-strings, blank messages, oversized messages, anything
 * matching a hard negative, and anything with no procedural phrasing.
 * Workflow is checked before strategy before skill, so the most specific and
 * most structured reading wins when a message matches more than one.
 */
export function classifyProceduralKind(
  message: unknown,
): ProceduralKind | null {
  try {
    if (typeof message !== "string") return null;

    const text = message.trim();

    if (text === "") return null;

    // Reject oversized input rather than truncating: a procedure described in
    // more than the cap is beyond this gate's remit.
    if (text.at(MAX_PROCEDURAL_MESSAGE_CHARS) !== undefined) return null;

    if (matchesAny(REJECT_PATTERNS, text)) return null;

    if (matchesAny(WORKFLOW_PATTERNS, text)) return "workflow";
    if (matchesAny(STRATEGY_PATTERNS, text)) return "strategy";
    if (matchesAny(SKILL_PATTERNS, text)) return "skill";

    return null;
  } catch {
    return null;
  }
}

/**
 * True only when the message explicitly describes a procedure.
 *
 * Thin wrapper over classifyProceduralKind, so the accepted/rejected set has
 * exactly one definition.
 */
export function isProceduralRequest(message: unknown): boolean {
  return classifyProceduralKind(message) !== null;
}
