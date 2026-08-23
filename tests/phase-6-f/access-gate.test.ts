/// <reference types="vitest" />

/**
 * Phase 6-G — TEST B: Production access-gate confirmation (config state only).
 *
 * Purpose: prove that the current environment cannot perform the
 * production-eligibility measurement itself — because it lacks an authenticated
 * / service-role read path. Mirrors the Phase 6-F `access-audit.mjs`
 * classification but is deterministic and network-free.
 *
 * Safety:
 *  - Only env-var KEY NAMES are read (via regex, values never captured).
 *  - Values are never printed, asserted on, or logged.
 *  - No network call is made.
 *  - No DB write. No session creation. No RLS interaction.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.env.local"
);

/** Return env-var KEY NAMES only; values are discarded and never exposed. */
const envKeyNames = (): string[] => {
  if (!fs.existsSync(ENV_PATH)) return [];
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  const names: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // Match the NAME that precedes the first '='. The value (group 2+) is
    // intentionally never captured, so no secret is ever held in a variable.
    const match = line.match(/^([A-Za-z_][A-Z0-9_]*)\s*=/);
    if (match) names.push(match[1]);
  }
  return names;
};

const hasServiceRoleKey = (names: string[]): boolean =>
  names.some(
    (n) => n === "SUPABASE_SERVICE_ROLE_KEY" || /SERVICE/i.test(n)
  );

const hasDirectDbKey = (names: string[]): boolean =>
  names.some(
    (n) => /DATABASE_URL|DIRECT_URL|POSTGRES_|PGHOST|^PG_/.test(n)
  );

describe("Phase 6-G — production read-access gate (config state)", () => {
  const names = envKeyNames();

  it("does not configure a service-role key", () => {
    expect(hasServiceRoleKey(names)).toBe(false);
    expect(names).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("does not configure a direct database connection string", () => {
    expect(hasDirectDbKey(names)).toBe(false);
  });

  it("if .env.local is present, only the public anon/URL keys exist", () => {
    if (names.length === 0) {
      // No env file -> by definition no privileged access is configured here.
      return;
    }
    expect(names).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ])
    );
    // Every configured key must be a non-privileged public key.
    expect(names.every((n) => n.startsWith("NEXT_PUBLIC_"))).toBe(true);
  });

  it("process.env also exposes no privileged credentials at test time", () => {
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.DIRECT_URL).toBeUndefined();
  });

  it("classifies the environment as INDETERMINATE (cannot measure prod candidates)", () => {
    // The single, authoritative question for Phase 6-F:
    const canReadProductionAuthed =
      hasServiceRoleKey(names) || hasDirectDbKey(names);
    // Expected Phase 6-F value: only anon keys -> reads are RLS-bound to
    // auth.uid() = null -> HTTP 200 with 0 rows cannot be distinguished from
    // a genuinely empty table. Hence INDETERMINATE.
    expect(canReadProductionAuthed).toBe(false);
  });
});
