/**
 * Feature flags.
 *
 * Guiding rule: every flag defaults to OFF.
 *
 * Only an explicit truthy token enables a flag: "1", "true", "yes", "on"
 * (compared after trimming and lowercasing). Anything else - a missing or empty
 * variable, "0", "false", a typo such as "ture", or any other unrecognized
 * value - evaluates to false. The module therefore fails closed: the live
 * product behaves exactly as it does today unless a flag is deliberately
 * enabled in the environment.
 *
 * Server-side only. Do not import this module from client components.
 *
 * The module is pure: no imports, no side effects, no caching. Each call reads
 * process.env directly, so a flag flip applies to the next request once the
 * deployment has picked the value up.
 *
 * See docs/FEATURE_FLAGS.md for the operator runbook and
 * docs/AGENT_LOOP_DESIGN.md for how the agent capabilities consume these flags.
 */

/** Boolean capability flags. All default to OFF. */
export type FeatureFlag =
  /** Enables the bounded agent loop (observe, think, act, answer) in the chat route. */
  | "ENABLE_AGENT_LOOP"
  /** Enables tool registration and execution for the agent loop. */
  | "ENABLE_TOOL_USE"
  /** Enables AI plan generation, in the background job worker only. */
  | "ENABLE_AI_PLANNER"
  /** Enables procedural-memory extraction and writing rules. */
  | "ENABLE_PROCEDURAL_MEMORY"
  /** Sub-flag of ENABLE_TOOL_USE: enables the external web-search tool only. */
  | "ENABLE_TOOL_WEB_SEARCH";

/** Numeric tuning flags. Missing or invalid values fall back to the defaults below. */
export type NumericFlag =
  | "AGENT_MAX_TOOL_TURNS"
  | "AGENT_LOOP_DEADLINE_MS"
  | "AGENT_TOOL_TIMEOUT_MS";

/** Every boolean flag, for diagnostics and tests. */
export const FEATURE_FLAGS: readonly FeatureFlag[] = Object.freeze([
  "ENABLE_AGENT_LOOP",
  "ENABLE_TOOL_USE",
  "ENABLE_AI_PLANNER",
  "ENABLE_PROCEDURAL_MEMORY",
  "ENABLE_TOOL_WEB_SEARCH",
]);

/** Safe defaults for the numeric flags, used when a variable is unset or unparsable. */
export const NUMERIC_FLAG_DEFAULTS: Readonly<Record<NumericFlag, number>> =
  Object.freeze({
    AGENT_MAX_TOOL_TURNS: 4,
    AGENT_LOOP_DEADLINE_MS: 45_000,
    AGENT_TOOL_TIMEOUT_MS: 10_000,
  });

/** The only string values (after trim and lowercase) that enable a flag. */
const TRUTHY: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);

/**
 * Valid numeric form: a positive decimal integer with no sign, no leading zero,
 * and no other characters. "0", "00", "07", "7.5", "12abc" and "-3" are all
 * rejected.
 */
const POSITIVE_INT = /^[1-9][0-9]*$/;

/**
 * True only when the flag environment variable is explicitly truthy.
 * Missing, empty, "0", "false", or any unrecognized value returns false.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[flag];

  if (typeof raw !== "string") return false;

  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Agent mode needs BOTH the loop and the tool registry. If either flag is off or
 * unset, the legacy single-call chat path is used, byte for byte unchanged.
 */
export function isAgentModeEnabled(): boolean {
  return (
    isFeatureEnabled("ENABLE_AGENT_LOOP") && isFeatureEnabled("ENABLE_TOOL_USE")
  );
}

/**
 * Reads a numeric flag. Invalid, non-positive, or unparsable values fall back to
 * NUMERIC_FLAG_DEFAULTS[flag], so a misconfigured environment can never produce a
 * zero, negative, or unbounded budget.
 */
export function readNumericFlag(flag: NumericFlag): number {
  const fallback = NUMERIC_FLAG_DEFAULTS[flag];
  const raw = process.env[flag];

  if (typeof raw !== "string") return fallback;

  const trimmed = raw.trim();

  if (!POSITIVE_INT.test(trimmed)) return fallback;

  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isSafeInteger(parsed)) return fallback;

  return parsed;
}

/**
 * Current state of every boolean flag. Intended for a startup or diagnostic log
 * line and for verification, never for branching logic - call isFeatureEnabled
 * directly at each decision point.
 */
export function getFeatureFlagSnapshot(): Record<FeatureFlag, boolean> {
  const snapshot = {} as Record<FeatureFlag, boolean>;

  for (const flag of FEATURE_FLAGS) {
    snapshot[flag] = isFeatureEnabled(flag);
  }

  return snapshot;
}