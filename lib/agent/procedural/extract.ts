/**
 * Procedural memory extractor (Priority 3).
 *
 * Turns a user message into a structured ProceduralMemory using the existing
 * AI provider, loaded lazily so tests can inject a stub and production only
 * pays for the import when extraction actually runs. The model is asked for
 * one JSON object; anything else (throw, non-string, malformed JSON, wrong
 * shape) degrades to the deterministic skeleton so the caller always gets a
 * usable memory and never an exception.
 *
 * The skeleton lives here rather than in `index.ts` because it is this
 * module's fallback; `index.ts` re-exports it unchanged, so every existing
 * import path keeps working and there is no import cycle between the two.
 *
 * No database, no side effects beyond the single model call. Nothing here is
 * imported by production code yet: the memory writer and the job wiring
 * arrive in later, separately reviewed steps. The existing extraction path
 * (`lib/memory/extractor.ts`, `lib/memory/aiExtractor.ts`,
 * `lib/memory/upsertMemory.ts`) is untouched.
 */

import type { ChatMessage } from "@/lib/ai/types";
import type {
  ProceduralKind,
  ProceduralMemory,
  ProceduralStep,
} from "./types";

/** Minimal provider surface the extractor needs. Mirrors AIProvider.chat. */
export interface ProceduralChatProvider {
  chat(messages: ChatMessage[]): Promise<string>;
}

/** Injectable dependencies. Every field is optional; defaults are production. */
export interface ExtractDeps {
  /** Defaults to getProvider() loaded lazily, so tests inject a stub. */
  provider?: ProceduralChatProvider;
}

/** Upper bound on the goal text carried into a memory. */
export const MAX_PROCEDURAL_GOAL_CHARS = 200;

/** Upper bound on the skeleton's name. */
export const MAX_SKELETON_NAME_CHARS = 120;

/** Upper bound on the skeleton step's action. */
export const MAX_SKELETON_ACTION_CHARS = 200;

/**
 * Confidence of a skeleton memory. Deliberately low: nothing was extracted,
 * the shape was only derived from the message, so a real extractor must
 * replace this rather than treat it as corroborated evidence.
 */
export const SKELETON_CONFIDENCE = 0.3;

/** The single step id a skeleton memory carries. */
export const SKELETON_STEP_ID = "step-1";

/** Bounds keeping model output small and memories usable. */
export const MAX_GENERATED_NAME_CHARS = 120;
export const MAX_GENERATED_TRIGGER_CHARS = 200;
export const MAX_GENERATED_ACTION_CHARS = 200;
export const MAX_GENERATED_STEPS = 12;
export const MAX_GENERATED_PRECONDITIONS = 6;
export const MAX_GENERATED_OUTCOME_CHARS = 200;

/**
 * Confidence bounds for an extracted memory. Never 1.0: the memory is derived
 * from one message and has not been corroborated, so it must stay below the
 * confidence of a fact the user stated directly.
 */
export const MIN_EXTRACTED_CONFIDENCE = 0.4;
export const MAX_EXTRACTED_CONFIDENCE = 0.9;
export const DEFAULT_EXTRACTED_CONFIDENCE = 0.6;

/** System instruction for the single extraction call. */
export const PROCEDURAL_EXTRACTOR_SYSTEM_PROMPT = [
  "You extract reusable procedures from a user's message.",
  "A procedure is how the user does something: a skill, a strategy or a workflow.",
  "Reply with ONLY one JSON object and nothing else, of the shape:",
  '{"kind": "skill|strategy|workflow", "name": "...", "trigger": "...", "steps": [{"action": "..."}], "preconditions": ["..."], "outcome": "...", "confidence": 0.6}',
  "Rules:",
  "- Use only what the message states. Never invent steps, tools or details the user did not mention.",
  "- If the message does not describe a reusable procedure, reply with {}.",
  "- 1 to 12 steps, each action a short imperative phrase.",
  "- kind is workflow for an ordered process, strategy for a decision policy, skill for a capability.",
  "- confidence is a number between 0 and 1 reflecting how clearly the message stated the procedure.",
].join("\n");

/** Resolves the chat provider without a static production import. */
async function resolveProvider(
  injected: ProceduralChatProvider | undefined,
): Promise<ProceduralChatProvider> {
  if (injected) return injected;

  const { getProvider } = await import("@/lib/ai/provider");

  return getProvider();
}

/** Builds the two-message conversation for the single extraction call. */
export function buildExtractorMessages(message: string): ChatMessage[] {
  return [
    { role: "system", content: PROCEDURAL_EXTRACTOR_SYSTEM_PROMPT },
    { role: "user", content: message },
  ];
}

/** Returns the first balanced JSON object at or after fromIndex, or null. */
export function extractBalancedJsonObject(
  text: string,
  fromIndex = 0,
): string | null {
  try {
    if (typeof text !== "string") return null;

    const start = text.indexOf("{", fromIndex);

    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index !== text.length; index += 1) {
      const ch = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }

        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
        continue;
      }

      if (ch === "}") {
        depth -= 1;

        if (depth === 0) return text.slice(start, index + 1);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Trims and caps text; non-strings become "". Never throws. */
function cleanText(value: unknown, cap: number): string {
  try {
    if (typeof value !== "string") return "";

    const trimmed = value.trim();

    if (trimmed === "") return "";

    if (trimmed.at(cap) === undefined) return trimmed;

    return trimmed.slice(0, cap);
  } catch {
    return "";
  }
}

/** Narrows a model-provided kind. Never throws. */
function isProceduralKind(value: unknown): value is ProceduralKind {
  return value === "skill" || value === "strategy" || value === "workflow";
}

/** Clamps a model-provided confidence into the corroboration-safe range. */
function clampConfidence(value: unknown): number {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return DEFAULT_EXTRACTED_CONFIDENCE;
    }

    if (value < MIN_EXTRACTED_CONFIDENCE) return MIN_EXTRACTED_CONFIDENCE;

    if (value > MAX_EXTRACTED_CONFIDENCE) return MAX_EXTRACTED_CONFIDENCE;

    return value;
  } catch {
    return DEFAULT_EXTRACTED_CONFIDENCE;
  }
}

/** Normalizes the model's steps into ordered, capped, id-stamped steps. */
function normalizeSteps(value: unknown): ProceduralStep[] {
  try {
    if (!Array.isArray(value)) return [];

    const steps: ProceduralStep[] = [];

    for (const entry of value) {
      if (steps.length === MAX_GENERATED_STEPS) break;

      const raw =
        entry !== null && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, unknown>)["action"]
          : entry;

      const action = cleanText(raw, MAX_GENERATED_ACTION_CHARS);

      if (action === "") continue;

      const order = steps.length + 1;

      steps.push({ id: `step-${order}`, order, action });
    }

    return steps;
  } catch {
    return [];
  }
}

/** Normalizes the model's preconditions into capped, non-empty strings. */
function normalizePreconditions(value: unknown): string[] {
  try {
    if (!Array.isArray(value)) return [];

    const conditions: string[] = [];

    for (const entry of value) {
      if (conditions.length === MAX_GENERATED_PRECONDITIONS) break;

      const condition = cleanText(entry, MAX_GENERATED_TRIGGER_CHARS);

      if (condition === "") continue;

      conditions.push(condition);
    }

    return conditions;
  } catch {
    return [];
  }
}

/**
 * Validates one model reply into a ProceduralMemory, or null when the reply
 * cannot be trusted. A procedure with no usable step is rejected outright, so
 * the caller degrades to the skeleton instead of storing a shapeless memory.
 * Never throws.
 */
export function parseExtractedMemory(
  raw: unknown,
  kind: ProceduralKind,
  message: string,
): ProceduralMemory | null {
  try {
    if (typeof raw !== "string") return null;

    const json = extractBalancedJsonObject(raw);

    if (json === null) return null;

    let parsed: unknown;

    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;

    const steps = normalizeSteps(candidate["steps"]);

    if (steps.length === 0) return null;

    const name = cleanText(candidate["name"], MAX_GENERATED_NAME_CHARS);

    return {
      memoryType: "procedural",
      // The model may re-classify what the gate found; a value outside the
      // union is not trusted, so the deterministic gate kind is kept.
      kind: isProceduralKind(candidate["kind"]) ? candidate["kind"] : kind,
      name: name === "" ? cleanText(message, MAX_SKELETON_NAME_CHARS) : name,
      trigger: cleanText(candidate["trigger"], MAX_GENERATED_TRIGGER_CHARS),
      steps,
      preconditions: normalizePreconditions(candidate["preconditions"]),
      outcome: cleanText(candidate["outcome"], MAX_GENERATED_OUTCOME_CHARS),
      confidence: clampConfidence(candidate["confidence"]),
    };
  } catch {
    return null;
  }
}

/**
 * Builds the deterministic skeleton memory for an accepted message.
 *
 * Everything is derived from the user's own words and capped; nothing is
 * invented and no model is consulted. Pure: same input, same output. Used as
 * the fallback whenever the model fails or its reply does not validate.
 */
export function skeletonMemory(
  message: string,
  kind: ProceduralKind,
): ProceduralMemory {
  const text = cleanText(message, MAX_PROCEDURAL_GOAL_CHARS);

  const step: ProceduralStep = {
    id: SKELETON_STEP_ID,
    order: 1,
    action: cleanText(message, MAX_SKELETON_ACTION_CHARS),
  };

  return {
    memoryType: "procedural",
    kind,
    name: cleanText(message, MAX_SKELETON_NAME_CHARS),
    trigger: text,
    steps: [step],
    preconditions: [],
    outcome: "",
    confidence: SKELETON_CONFIDENCE,
  };
}

/**
 * Extracts one structured procedural memory. Never throws and never returns
 * null: a model failure, an unusable reply, or a reply that fails validation
 * all degrade to the deterministic skeleton, so the caller always receives a
 * usable ProceduralMemory.
 */
export async function extractProceduralMemory(
  message: string,
  kind: ProceduralKind,
  deps: ExtractDeps = {},
): Promise<ProceduralMemory> {
  try {
    const provider = await resolveProvider(deps.provider);

    const raw = await provider.chat(buildExtractorMessages(message));

    return parseExtractedMemory(raw, kind, message) ?? skeletonMemory(message, kind);
  } catch {
    return skeletonMemory(message, kind);
  }
}


