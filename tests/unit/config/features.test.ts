import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NumericFlag } from "@/lib/config/features";
import {
  FEATURE_FLAGS,
  NUMERIC_FLAG_DEFAULTS,
  getFeatureFlagSnapshot,
  isAgentModeEnabled,
  isFeatureEnabled,
  readNumericFlag,
} from "@/lib/config/features";

/**
 * Every environment variable this module reads. Cleared before and after each
 * test so results are deterministic no matter what a shell, .env.local file, or
 * a previous test left behind.
 */
const MANAGED_KEYS: string[] = [
  ...FEATURE_FLAGS,
  ...(Object.keys(NUMERIC_FLAG_DEFAULTS) as NumericFlag[]),
];

function clearManagedKeys(): void {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }
}

beforeEach(clearManagedKeys);
afterEach(clearManagedKeys);

/** Values that must enable a flag (case- and whitespace-insensitive). */
const TRUTHY_VALUES = [
  "1",
  "true",
  "TRUE",
  "True",
  "yes",
  "YES",
  "on",
  "ON",
  " true ",
  "\ton\n",
];

/** Values that must NOT enable a flag. "ture" is the typo case. */
const NON_TRUTHY_VALUES = [
  "",
  "   ",
  "0",
  "false",
  "FALSE",
  "False",
  "no",
  "NO",
  "off",
  "OFF",
  "ture",
  "tru",
  "truey",
  "enabled",
  "disabled",
  "2",
  "-1",
  "0.0",
  "undefined",
  "null",
  "maybe",
];

describe("feature flags - fail-closed default", () => {
  it("every declared flag is OFF when its variable is unset", () => {
    for (const flag of FEATURE_FLAGS) {
      expect(isFeatureEnabled(flag)).toBe(false);
    }
  });

  it("the snapshot reports every flag false", () => {
    const snapshot = getFeatureFlagSnapshot();

    expect(Object.keys(snapshot).sort()).toEqual([...FEATURE_FLAGS].sort());

    for (const flag of FEATURE_FLAGS) {
      expect(snapshot[flag]).toBe(false);
    }
  });

  it("agent mode is OFF when no flags are set", () => {
    expect(isAgentModeEnabled()).toBe(false);
  });
});

describe("feature flags - explicit opt-in only", () => {
  for (const value of TRUTHY_VALUES) {
    it("enables a flag for " + JSON.stringify(value), () => {
      process.env.ENABLE_AGENT_LOOP = value;

      expect(isFeatureEnabled("ENABLE_AGENT_LOOP")).toBe(true);
    });
  }
});

describe("feature flags - unrecognized values stay OFF", () => {
  for (const value of NON_TRUTHY_VALUES) {
    it("keeps the flag off for " + JSON.stringify(value), () => {
      process.env.ENABLE_AGENT_LOOP = value;

      expect(isFeatureEnabled("ENABLE_AGENT_LOOP")).toBe(false);
      expect(isAgentModeEnabled()).toBe(false);
    });
  }

  it("one flag never enables another", () => {
    process.env.ENABLE_AGENT_LOOP = "true";

    expect(isFeatureEnabled("ENABLE_TOOL_USE")).toBe(false);
    expect(isFeatureEnabled("ENABLE_AI_PLANNER")).toBe(false);
    expect(isFeatureEnabled("ENABLE_PROCEDURAL_MEMORY")).toBe(false);
    expect(isFeatureEnabled("ENABLE_TOOL_WEB_SEARCH")).toBe(false);
    expect(isFeatureEnabled("ENABLE_MULTI_AGENT")).toBe(false);
    expect(isFeatureEnabled("ENABLE_CONTINUAL_LEARNING")).toBe(false);
  });
});

describe("agent mode requires both flags", () => {
  it("is OFF with only the loop enabled", () => {
    process.env.ENABLE_AGENT_LOOP = "true";

    expect(isAgentModeEnabled()).toBe(false);
  });

  it("is OFF with only tool use enabled", () => {
    process.env.ENABLE_TOOL_USE = "true";

    expect(isAgentModeEnabled()).toBe(false);
  });

  it("is ON only when both are enabled", () => {
    process.env.ENABLE_AGENT_LOOP = "true";
    process.env.ENABLE_TOOL_USE = "true";

    expect(isAgentModeEnabled()).toBe(true);
  });

  it("is OFF again when one flag is disabled", () => {
    process.env.ENABLE_AGENT_LOOP = "true";
    process.env.ENABLE_TOOL_USE = "true";
    process.env.ENABLE_TOOL_USE = "false";

    expect(isAgentModeEnabled()).toBe(false);
  });
});

describe("numeric flags", () => {
  it("fall back to the documented defaults when unset", () => {
    for (const flag of Object.keys(NUMERIC_FLAG_DEFAULTS) as NumericFlag[]) {
      expect(readNumericFlag(flag)).toBe(NUMERIC_FLAG_DEFAULTS[flag]);
    }
  });

  it("parses a valid positive integer", () => {
    process.env.AGENT_MAX_TOOL_TURNS = "7";

    expect(readNumericFlag("AGENT_MAX_TOOL_TURNS")).toBe(7);
  });

  it("trims surrounding whitespace", () => {
    process.env.AGENT_MAX_TOOL_TURNS = " 9 ";

    expect(readNumericFlag("AGENT_MAX_TOOL_TURNS")).toBe(9);
  });

  const INVALID_NUMERIC_VALUES = [
    "",
    "   ",
    "0",
    "00",
    "07",
    "-3",
    "7.5",
    "12abc",
    "abc",
    "Infinity",
    "1e3",
    "true",
  ];

  for (const value of INVALID_NUMERIC_VALUES) {
    it("falls back for invalid value " + JSON.stringify(value), () => {
      process.env.AGENT_LOOP_DEADLINE_MS = value;

      expect(readNumericFlag("AGENT_LOOP_DEADLINE_MS")).toBe(
        NUMERIC_FLAG_DEFAULTS.AGENT_LOOP_DEADLINE_MS
      );
    });
  }

  it("boolean and numeric namespaces stay independent", () => {
    process.env.AGENT_MAX_TOOL_TURNS = "1";

    expect(isFeatureEnabled("ENABLE_AGENT_LOOP")).toBe(false);

    process.env.ENABLE_AGENT_LOOP = "true";

    expect(readNumericFlag("AGENT_MAX_TOOL_TURNS")).toBe(1);
  });
});