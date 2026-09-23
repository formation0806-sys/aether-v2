/**
 * current_time tool.
 *
 * Pure and read-only: it reads the clock and formats it. No database access, no
 * network, no writes. Registered only when ENABLE_TOOL_USE is enabled, which is
 * OFF by default.
 */

import type {
  ToolArgsParser,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types";

export const CURRENT_TIME_TOOL_NAME = "current_time";

/** Arguments accepted by the tool. A type alias, not an interface, so it stays
 *  assignable to the ToolDefinition default argument type. */
export type CurrentTimeArgs = {
  /** Optional IANA time zone name, for example "Asia/Tokyo". */
  timeZone?: string;
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Tolerant argument parsing: never throws.
 *
 * No arguments at all is valid, because the model may send {} or nothing. A
 * present but unusable time zone is invalid: silently ignoring it would produce a
 * misleading answer.
 */
const parseArgs: ToolArgsParser<CurrentTimeArgs> = (raw) => {
  if (raw === undefined || raw === null) return {};

  if (typeof raw !== "object") return null;

  const candidate = (raw as Record<string, unknown>).timeZone;

  if (candidate === undefined || candidate === null) return {};

  if (typeof candidate !== "string") return null;

  const trimmed = candidate.trim();

  if (trimmed === "") return null;

  return { timeZone: trimmed };
};

/**
 * True when Intl accepts the identifier as a time zone. Uses the built-in Intl
 * database, so no dependency is added.
 */
function isValidTimeZone(timeZone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone });

    return formatter.resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

function formatInTimeZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(at);
}

function utcWeekday(at: Date): string {
  return WEEKDAYS[at.getUTCDay()] ?? "unknown";
}

/**
 * Builds the tool. The clock is injectable so tests are deterministic; the
 * production instance uses the real clock.
 */
export function createCurrentTimeTool(
  now: () => Date = () => new Date()
): ToolDefinition<CurrentTimeArgs> {
  return {
    name: CURRENT_TIME_TOOL_NAME,
    description:
      "Returns the current date and time in UTC, and optionally in a named IANA time zone.",
    requiredFlags: ["ENABLE_TOOL_USE"],
    timeoutMs: 2000,
    parseArgs,
    async execute(args: CurrentTimeArgs, ctx: ToolContext): Promise<ToolResult> {
      const startedAt = Date.now();

      const done = (ok: boolean, observation: string): ToolResult => ({
        ok,
        observation,
        meta: { durationMs: Date.now() - startedAt },
      });

      if (ctx.signal.aborted) {
        return done(
          false,
          "TOOL_ABORTED: the turn was cancelled before the tool started."
        );
      }

      const at = now();

      if (Number.isNaN(at.getTime())) {
        return done(false, "TOOL_ERROR: the clock returned an invalid date.");
      }

      const lines = [
        "UTC: " + at.toISOString(),
        "UTC day: " + utcWeekday(at),
        "Unix milliseconds: " + String(at.getTime()),
      ];

      if (args.timeZone) {
        if (isValidTimeZone(args.timeZone)) {
          lines.push(
            "In " + args.timeZone + ": " + formatInTimeZone(at, args.timeZone)
          );
        } else {
          lines.push(
            "Note: \"" +
              args.timeZone +
              "\" is not a recognized IANA time zone, so only UTC is shown."
          );
        }
      } else {
        lines.push(
          "Note: no timeZone argument was given, so the user local time is unknown. Answer in UTC and do not guess an offset."
        );
      }

      return done(true, lines.join("\n"));
    },
  };
}

/** Production instance, registered through the tool registry. */
export const currentTimeTool = createCurrentTimeTool();