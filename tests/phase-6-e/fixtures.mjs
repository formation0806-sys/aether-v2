// ============================================================
// PHASE 6-E — EXPERIMENTAL ARTIFACT (DO NOT USE IN PRODUCTION)
// ============================================================
// Fixed input fixtures. Each memory carries distinctive keywords
// used by the automated quality rubric to deterministically test
// grounding.
//
// - `grouped`  = production-shaped ReflectionInput[] (type-keyed
//                groups, mirroring lib/core/pipeline.ts:104-134).
// - `combined` = experiment-only shape where the SAME evidence is
//                presented in a single group (tests grouping).
// ============================================================

function buildGroups(typeToMemories) {
  return Object.entries(typeToMemories).map(([memoryType, memories]) => ({
    memoryType,
    memories: memories.map(({ id, title, content, summary }) => ({
      id, title, content, summary,
    })),
  }));
}

function combinedGroups(sources) {
  return [
    {
      memoryType: "combined",
      memories: sources.map(({ id, title, content, summary }) => ({
        id, title, content, summary,
      })),
    },
  ];
}

const m = (id, type, title, content, summary) => ({ id, type, title, content, summary });

const A_SOURCES = [
  m("a1", "semantic", "Dark Mode Preference",
    "The user prefers dark mode for all software interfaces.", "dark mode preference"),
  m("a2", "semantic", "OLED Theme Choice",
    "The user always chooses the OLED pure-black theme when available.", "OLED theme choice"),
];

const B_SOURCES = [
  m("b1", "identity", "Morning Person",
    "The user is a morning person who wakes up at 5:30 AM every day.", "morning person"),
  m("b2", "semantic", "Black Coffee Habit",
    "The user drinks black coffee every morning before 7 AM.", "black coffee habit"),
];

const C_SOURCES = [
  m("c1", "semantic", "Dark Mode Preference",
    "The user prefers dark mode for all software interfaces.", "dark mode preference"),
  m("c2", "semantic", "OLED Theme Choice",
    "The user always chooses the OLED pure-black theme when available.", "OLED theme choice"),
  m("c3", "semantic", "Low Screen Brightness",
    "The user disables auto-brightness and keeps screen brightness low.", "low brightness"),
  m("c4", "identity", "Night Owl",
    "The user is a night owl and often codes past midnight.", "night owl"),
  m("c5", "identity", "Frontend Developer",
    "The user is a software developer focused on frontend development.", "frontend developer"),
];

function scenario(id, name, sources, keywords) {
  const byType = {};
  for (const s of sources) {
    (byType[s.type] = byType[s.type] || []).push(s);
  }
  return {
    id,
    name,
    sources,
    keywords,
    grouped: buildGroups(byType),
    combined: combinedGroups(sources),
  };
}

export const SCENARIOS = {
  A: scenario("A", "Two semantic memories (obvious grounded relationship)",
    A_SOURCES, { a1: ["dark mode", "dark"], a2: ["oled"] }),
  B: scenario("B", "Cross-type memories (1 identity + 1 semantic)",
    B_SOURCES, { b1: ["morning person", "5:30", "morning"], b2: ["black coffee", "coffee"] }),
  C: scenario("C", "Larger mixed set (3 semantic + 2 identity)",
    C_SOURCES, {
      c1: ["dark mode", "dark"],
      c2: ["oled"],
      c3: ["auto-brightness", "brightness"],
      c4: ["night owl", "midnight"],
      c5: ["frontend"],
    }),
};

export const SCENARIO_IDS = ["A", "B", "C"];

/** Input for a run: production `grouped` or experiment `combined`. */
export function inputFor(scenario, variant) {
  return variant === "combined" ? scenario.combined : scenario.grouped;
}