/**
 * Phase 2 — Identity Intelligence Audit fixtures.
 *
 * Hand-crafted observations keyed by eligible memory id. Authoring workflow:
 * run PHASE2_SKIP_LIVE=1 first to get the census, then author observations
 * targeting the actual eligible rows.
 *
 * Faithfulness policy (no invented facts): each observation only restates or
 * contradicts facts already present in the source memory content (census
 * candidatePreviews). No dates, plans, relationships, or personal attributes
 * beyond the source content are introduced.
 */
import type { MemoryRow } from "./probe-lib";

export type Observation = {
  title: string;
  content: string;
  memoryType: MemoryRow["memory_type"];
};

export type ObservationEntry = {
  paraphrase: Observation; // V2 — same fact, different words → corroborate
  contradiction: Observation; // V4 — conflicting value on same topic → create
  ambiguous: Observation; // V5 — related topic, different entity/scope → create
};

/**
 * Keyed by eligible memory id. Populated from Phase 1-C census.json
 * (7 eligible memories). Runtime cross-check skips stale keys.
 */
export const OBSERVATIONS: Record<string, ObservationEntry> = {
  // 0a97a74a — project — "The user is building a project called Aether with Next.js and Supabase."
  "0a97a74a-cac6-4b70-ac8c-23f28f951cc0": {
    paraphrase: {
      title: "Aether Development Stack",
      content:
        "The user is developing Aether using Next.js for the frontend and Supabase for the backend.",
      memoryType: "project",
    },
    contradiction: {
      title: "Abandoned Project",
      content:
        "The user has stopped working on Aether and no longer maintains the project.",
      memoryType: "project",
    },
    ambiguous: {
      title: "Aether Collaboration",
      content:
        "The user's colleague is building a project called Aether with Next.js and Supabase.",
      memoryType: "project",
    },
  },

  // 558ad91c — project — "The user plans to make chicken briyani for tonight."
  "558ad91c-8802-490d-8497-3c284a5e83d7": {
    paraphrase: {
      title: "Dinner Preparation",
      content:
        "The user intends to cook chicken briyani for this evening's meal.",
      memoryType: "project",
    },
    contradiction: {
      title: "Meal Cancellation",
      content:
        "The user decided not to make chicken briyani and ordered takeout instead.",
      memoryType: "project",
    },
    ambiguous: {
      title: "Briyani Recipe",
      content:
        "The user's neighbor plans to make chicken briyani for tonight.",
      memoryType: "project",
    },
  },

  // 588f81e8 — project — "The user is building Aether as their long-term AI teammate project."
  "588f81e8-c4e6-4230-8b2e-b8326b6f9d9c": {
    paraphrase: {
      title: "Long-term AI Teammate",
      content:
        "Aether is the user's ongoing initiative to create an AI teammate for the long haul.",
      memoryType: "project",
    },
    contradiction: {
      title: "Project Pivot",
      content:
        "The user has deprioritized the Aether AI teammate project in favor of other work.",
      memoryType: "project",
    },
    ambiguous: {
      title: "AI Teammate Research",
      content:
        "The user is researching AI teammate frameworks for a future project idea.",
      memoryType: "project",
    },
  },

  // 0be6f80c — project — "The user is seeking the secret test phrase for Aether."
  "0be6f80c-ca34-4713-bf9f-cbe9d18a2b44": {
    paraphrase: {
      title: "Test Phrase Request",
      content:
        "The user is looking for the secret test phrase associated with Aether.",
      memoryType: "project",
    },
    contradiction: {
      title: "Test Phrase Found",
      content:
        "The user already knows the secret test phrase and no longer needs to search for it.",
      memoryType: "project",
    },
    ambiguous: {
      title: "Aether Documentation",
      content:
        "The user is reading the Aether documentation which mentions a test phrase.",
      memoryType: "project",
    },
  },

  // ab39fc3e — identity — "The user's favorite programming language is Rust."
  "ab39fc3e-93b2-4880-81c9-9902c55da6c2": {
    paraphrase: {
      title: "Preferred Language",
      content: "Rust is the programming language the user likes best.",
      memoryType: "identity",
    },
    contradiction: {
      title: "Language Preference Change",
      content:
        "The user's favorite programming language is Python, not Rust.",
      memoryType: "identity",
    },
    ambiguous: {
      title: "Rust Recommendation",
      content:
        "The user's mentor recommends Rust as a good language to learn.",
      memoryType: "identity",
    },
  },

  // eba42f5e — project — "The user's secret Aether test phrase is ORBIT-7429."
  "eba42f5e-647f-4e5e-9c02-bb48913ea0bc": {
    paraphrase: {
      title: "Aether Access Code",
      content: "The secret phrase for Aether is ORBIT-7429.",
      memoryType: "project",
    },
    contradiction: {
      title: "Phrase Revision",
      content:
        "The user's secret Aether test phrase has been changed to NOVA-3107.",
      memoryType: "project",
    },
    ambiguous: {
      title: "ORBIT Reference",
      content:
        "The user wrote down ORBIT-7429 as a reminder for an unrelated task.",
      memoryType: "project",
    },
  },

  // e31e95a0 — identity — "The user identifies as an engineer..."
  "e31e95a0-c34d-48b7-bcdd-9c3ea939f08b": {
    paraphrase: {
      title: "Professional Identity",
      content:
        "The user considers themselves an engineer and this forms a key part of their professional identity.",
      memoryType: "identity",
    },
    contradiction: {
      title: "Career Transition",
      content:
        "The user no longer works as an engineer and has moved into product management.",
      memoryType: "identity",
    },
    ambiguous: {
      title: "Engineering Background",
      content:
        "The user's sibling is an engineer and works at a tech company.",
      memoryType: "identity",
    },
  },
};

/**
 * Pre-authored pool of confirmed-absent-topic observations for V3 swap.
 * Topics chosen to be semantically distant from typical user memory content.
 */
export const V3_FALLBACKS: Observation[] = [
  {
    title: "Underwater Basket Weaving",
    content:
      "The user enjoys weaving baskets while submerged in water.",
    memoryType: "semantic",
  },
  {
    title: "Vintage Typewriter Repair",
    content:
      "The user collects and repairs vintage manual typewriters.",
    memoryType: "semantic",
  },
  {
    title: "Competitive Cheese Rolling",
    content:
      "The user participates in annual cheese-rolling competitions.",
    memoryType: "semantic",
  },
];
