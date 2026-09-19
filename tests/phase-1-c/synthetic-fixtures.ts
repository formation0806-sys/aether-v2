/**
 * Phase 1-C Step 1 — V3 synthetic grounded fixtures.
 *
 * Documented REPLICA of the proven Phase 6-E grounded fixture methodology
 * (tests/phase-6-e/fixtures.mjs, scenarios A/B/C): distinctive keyword-bearing
 * content known to support grounded reflection with the production prompt and
 * model. Reimplemented in TypeScript so the probe typechecks under tsc.
 * DO NOT USE IN PRODUCTION.
 */

export interface FixtureMemory {
  id: string;
  type: string;
  title: string;
  content: string;
  summary: string;
}

export interface FixtureScenario {
  id: string;
  name: string;
  sources: FixtureMemory[];
  grouped: Array<{
    memoryType: string;
    memories: Array<{
      id: string;
      title: string;
      content: string;
      summary: string;
      importance: number | null;
      confidence: number | null;
      memoryType: string;
      tags: string[] | null;
      metadata: Record<string, unknown> | null;
    }>;
  }>;
}

function buildGroups(sources: FixtureMemory[]) {
  const byType: Record<string, FixtureMemory[]> = {};
  for (const s of sources) {
    (byType[s.type] = byType[s.type] ?? []).push(s);
  }
  return Object.entries(byType).map(([memoryType, memories]) => ({
    memoryType,
      memories: memories.map(({ id, title, content, summary }) => ({
      id,
      title,
      content,
      summary,
      importance: null,
      confidence: null,
      memoryType,
      tags: null,
      metadata: null,
    })),
  })) as FixtureScenario["grouped"];
}

function scenario(
  id: string,
  name: string,
  sources: FixtureMemory[]
): FixtureScenario {
  return { id, name, sources, grouped: buildGroups(sources) };
}

export const SCENARIO_A = scenario("A", "Two semantic memories (obvious grounded relationship)", [
  { id: "a1", type: "semantic", title: "Dark Mode Preference", content: "The user prefers dark mode for all software interfaces.", summary: "dark mode preference" },
  { id: "a2", type: "semantic", title: "OLED Theme Choice", content: "The user always chooses the OLED pure-black theme when available.", summary: "OLED theme choice" },
]);

export const SCENARIO_B = scenario("B", "Cross-type memories (1 identity + 1 semantic)", [
  { id: "b1", type: "identity", title: "Morning Person", content: "The user is a morning person who wakes up at 5:30 AM every day.", summary: "morning person" },
  { id: "b2", type: "semantic", title: "Black Coffee Habit", content: "The user drinks black coffee every morning before 7 AM.", summary: "black coffee habit" },
]);

export const SCENARIO_C = scenario("C", "Larger mixed set (3 semantic + 2 identity)", [
  { id: "c1", type: "semantic", title: "Dark Mode Preference", content: "The user prefers dark mode for all software interfaces.", summary: "dark mode preference" },
  { id: "c2", type: "semantic", title: "OLED Theme Choice", content: "The user always chooses the OLED pure-black theme when available.", summary: "OLED theme choice" },
  { id: "c3", type: "semantic", title: "Low Screen Brightness", content: "The user disables auto-brightness and keeps screen brightness low.", summary: "low brightness" },
  { id: "c4", type: "identity", title: "Night Owl", content: "The user is a night owl and often codes past midnight.", summary: "night owl" },
  { id: "c5", type: "identity", title: "Frontend Developer", content: "The user is a software developer focused on frontend development.", summary: "frontend developer" },
]);

export function syntheticInputFor(
  id: "A" | "B" | "C"
): FixtureScenario["grouped"] {
  const scenario = id === "A" ? SCENARIO_A : id === "B" ? SCENARIO_B : SCENARIO_C;
  return scenario.grouped;
}
