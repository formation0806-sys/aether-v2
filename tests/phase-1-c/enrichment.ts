/**
 * Phase 1-C Step 1 — V2 authored synthetic enrichment.
 *
 * Populated AFTER the real-data census so enrichment targets the actual
 * eligible rows. Every entry is SYNTHETIC, authored for this probe only,
 * and clearly labeled in the measurement artifact. The probe never writes
 * enrichment to the database — it exists only inside V2's in-memory input.
 *
 * Keyed by memory id. Rows without an authored entry receive a clearly
 * labeled generic fallback.
 */
import type { MemoryRow } from "./probe-lib";

// AUTHORED SYNTHETIC ENRICHMENT (Phase 1-C probe, V2 leg).
//
// Populated from tests/phase-1-c/census.json (7 eligible memories only).
// Every entry is hand-authored for this measurement probe and is clearly
// labelled synthetic. It is NEVER written to the database — it only replaces
// the `summary` field of in-memory ReflectionInput items for the V2 attempt,
// so V2 = real memories + richer summaries vs. V1 = real memories as-is.
//
// Faithfulness policy (no invented facts): each summary restates context that
// is already explicit in the memory content (census candidatePreviews). Where a
// latent relationship is surfaced, it is one that both source memories already
// express (e.g. the seeking/answer pair around the Aether test phrase, and the
// two framings of the Aether project). No dates, plans, relationships, or
// personal attributes beyond the source content are introduced.
export const AUTHORED_ENRICHMENT: Record<string, string> = {
  // 0a97a74a — project — "The user is building a project called Aether with Next.js and Supabase."
  "0a97a74a-cac6-4b70-ac8c-23f28f951cc0":
    "[Synthetic enrichment — Phase 1-C probe] Aether is the user's active software project built with Next.js and Supabase; an ongoing development effort.",

  // 558ad91c — project — "The user plans to make chicken briyani for tonight."
  "558ad91c-8802-490d-8497-3c284a5e83d7":
    "[Synthetic enrichment — Phase 1-C probe] A near-term user plan to prepare chicken briyani for an upcoming meal; connects the user's project work to an everyday life intention.",

  // 588f81e8 — project — "The user is building Aether as their long-term AI teammate project."
  "588f81e8-c4e6-4230-8b2e-b8326b6f9d9c":
    "[Synthetic enrichment — Phase 1-C probe] Characterizes Aether as a long-term AI-teammate project; reinforces the strategic framing and the Next.js + Supabase stack already described in memory 0a97a74a.",

  // 0be6f80c — project — "The user is seeking the secret test phrase for Aether."
  "0be6f80c-ca34-4713-bf9f-cbe9d18a2b44":
    "[Synthetic enrichment — Phase 1-C probe] The user is actively seeking the secret test phrase tied to the Aether project; a knowledge-seeking intent that pairs with memory eba42f5e.",

  // ab39fc3e — identity — "The user's favorite programming language is Rust."
  "ab39fc3e-93b2-4880-81c9-9902c55da6c2":
    "[Synthetic enrichment — Phase 1-C probe] The user's stated programming-language preference is Rust; a stable technical preference that informs how the user writes code.",

  // eba42f5e — project — "The user's secret Aether test phrase is ORBIT-7429."
  "eba42f5e-647f-4e5e-9c02-bb48913ea0bc":
    "[Synthetic enrichment — Phase 1-C probe] The Aether secret test phrase is ORBIT-7429; the concrete answer matching the seeking intent in memory 0be6f80c.",

  // e31e95a0 — identity — "The user identifies as an engineer..."
  "e31e95a0-c34d-48b7-bcdd-9c3ea939f08b":
    "[Synthetic enrichment — Phase 1-C probe] The user identifies as an engineer; a core identity attribute that contextualizes the technical Aether project and the Rust preference.",
};

export function isAuthored(id: string): boolean {
  return Boolean(AUTHORED_ENRICHMENT[id]);
}

export function enrichmentFor(row: MemoryRow): string {
  const authored = AUTHORED_ENRICHMENT[row.id];
  if (authored) return authored;
  return `[Synthetic enrichment — Phase 1-C probe] This ${row.memory_type} memory ("${row.title}") records: ${row.content.slice(0, 200)}. It is part of the user's ongoing records and may connect to related observations in the supplied set.`;
}
