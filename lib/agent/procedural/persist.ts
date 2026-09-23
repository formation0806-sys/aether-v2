/**
 * Procedural memory persistence (Priority 3).
 *
 * Writes a ProceduralMemory through the existing memory write path only —
 * specifically `saveMemory()` in `lib/memory/memory.ts`, which delegates to the
 * V2 repository (`insertMemoryV2`). The `memories` table already carries
 * `memory_type='procedural'` (enum `0001_memory_v2_enums.sql`), and
 * `lib/memory/types.ts` + `lib/memory/constants.ts` already tune weights,
 * half-life, token budget and `INJECT_CAPS` for it. So a procedural memory is
 * stored as one normal `memories` row with `memory_type='procedural'`: no new
 * table and no migration.
 *
 * Why reuse `saveMemory` instead of `insertMemoryV2` directly: `saveMemory` is
 * the single place that scores, embeds, title-dedups and promotes to `active`.
 * Reusing it keeps procedural writes consistent with every other memory type.
 *
 * Safety properties (each unit tested):
 *  - `extractAndPersistProcedural` with `persist:false` (the default) performs
 *    zero writes, no repository access and no embedding cost.
 *  - Never throws. Every failure is a returned ProceduralPersistResult.
 *  - `saveMemory` is loaded lazily via `await import("@/lib/memory/memory")`;
 *    it is NOT statically imported here, so importing this module never pulls
 *    in the Supabase client or embedding stack. Tests inject a stub saver.
 *  - Flag-gated: `extractAndPersistProcedural` checks
 *    `ENABLE_PROCEDURAL_MEMORY` first (via `extractOrDefer`); with the flag off
 *    it short-circuits to `procedural_disabled` and touches nothing.
 *
 * Nothing in this module is called from production yet: the existing extraction
 * path (`lib/memory/extractor.ts`, `lib/memory/aiExtractor.ts`), the memory job
 * worker, `lib/memory/upsertMemory.ts`, and the chat route are all untouched.
 */

import type { FeatureFlag } from "@/lib/config/features";
import type { MemoryStatus, MemorySource } from "@/lib/memory/types";
import type { ProceduralChatProvider } from "./extract";
import { extractOrDefer } from "./index";
import type {
  ProceduralDeferReason,
  ProceduralMemory,
  ProceduralRequest,
} from "./types";

/** Max chars kept on the memory row title. */
export const MAX_PERSIST_TITLE_CHARS = 120;

/** Max chars kept on one rendered step line within the content payload. */
export const MAX_PERSIST_STEP_CHARS = 200;

/** Hard cap on the whole `content` payload written to the memory row. */
export const MAX_PERSIST_CONTENT_CHARS = 4000;

/** Tag written with every procedural memory so it can be filtered later. */
export const PROCEDURAL_MEMORY_TAG = "procedural";

/** Source written with every procedural memory row. */
export const PROCEDURAL_MEMORY_SOURCE: MemorySource = "extractor";

/** `source_ref` written with every procedural memory row. */
export const PROCEDURAL_SOURCE_REF = "enable_procedural_memory";

/** Status written for a freshly extracted procedural memory. */
export const PROCEDURAL_MEMORY_STATUS: MemoryStatus = "candidate";

/** Status of one persistence attempt. */
export type ProceduralPersistStatus =
  | "persisted"
  | "persisted_idempotent"
  | "failed"
  | "skipped";

/** Why persistence was skipped, short-circuited, or reported as failed. */
export type ProceduralPersistReason =
  | "procedural_disabled"
  | "not_procedural"
  | "invalid_request"
  | "save_memory_unavailable"
  | "save_memory_error";

/** The outcome of persisting one procedural memory. */
export interface ProceduralPersistResult {
  status: ProceduralPersistStatus;
  /** Null when nothing went wrong; a reason otherwise. */
  reason: ProceduralPersistReason | null;
  /** Title used for the memory row, or null when nothing was written. */
  title: string | null;
  /** The memory row id returned by saveMemory, or null when no row was created. */
  id: string | null;
}

/**
 * The write function this module calls. Matches `saveMemory` in
 * `lib/memory/memory.ts` (SaveMemoryInput); `memoryType` is pinned to
 * `"procedural"` so callers need no casting.
 */
export interface ProceduralSaver {
  (input: {
    userId: string;
    title: string;
    content: string;
    memoryType?: "procedural";
    status?: MemoryStatus;
    summary?: string;
    tags?: string[];
    importance?: number;
    confidence?: number;
    explicit?: boolean;
    source?: MemorySource;
    sourceRef?: string | null;
    projectId?: string | null;
    metadata?: Record<string, unknown>;
    observationId?: string | null;
  }): Promise<unknown>;
}

/** Injections for `extractAndPersistProcedural`. */
export interface ExtractAndPersistProceduralDeps {
  /** Defaults to `isFeatureEnabled()`. */
  isFlagEnabled?: (flag: FeatureFlag) => boolean;
  /** Passed through to `extractOrDefer`. */
  provider?: ProceduralChatProvider;
  /** Injected `saveMemory`; loaded lazily in production when `persist:true`. */
  saver?: ProceduralSaver;
  /** When true the extracted memory is persisted. Defaults to false (inert). */
  persist?: boolean;
}

/** Outcome of `extractAndPersistProcedural`. */
export type ExtractAndPersistProceduralOutcome =
  | {
      kind: "extracted";
      memory: ProceduralMemory;
      persistence: ProceduralPersistResult | null;
    }
  | {
      kind: "deferred";
      reason: ProceduralDeferReason;
      persistence: null;
    };

/**
 * Resolves one procedural saver. Uses the injected one when present; otherwise
 * loads `@/lib/memory/memory` lazily so importing this module never pulls in
 * the Supabase client or embedding stack at module load time. Returns null
 * when no saver is available. Never throws.
 */
export async function loadSaver(
  saver?: ProceduralSaver,
): Promise<ProceduralSaver | null> {
  if (saver) return saver;

  try {
    const mod = (await import("@/lib/memory/memory")) as unknown as {
      saveMemory?: ProceduralSaver;
    };

    return typeof mod.saveMemory === "function" ? mod.saveMemory : null;
  } catch {
    return null;
  }
}

/** Returns true when the value looks like a uuid. Never throws. */
function isUuidLike(value: unknown): boolean {
  try {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    );
  } catch {
    return false;
  }
}

/**
 * Builds a deterministic title from a ProceduralMemory so re-persisting the
 * same procedure lands on the same title (and therefore the same-row path in
 * `saveMemory`) rather than duplicating rows.
 */
function buildTitle(memory: ProceduralMemory): string {
  try {
    const raw = memory.name ?? "";

    const trimmed = typeof raw === "string" ? raw.trim() : "";

    if (trimmed === "") return "procedural memory";

    if (trimmed.at(MAX_PERSIST_TITLE_CHARS) === undefined) return trimmed;

    return trimmed.slice(0, MAX_PERSIST_TITLE_CHARS);
  } catch {
    return "procedural memory";
  }
}

/**
 * Renders the procedure as a compact, human-readable content string so the
 * memory row is useful to retrieve and re-inject later. Capped at
 * `MAX_PERSIST_CONTENT_CHARS` characters. Never throws.
 */
function buildContent(memory: ProceduralMemory): string {
  try {
    const lines: string[] = [];

    if (typeof memory.trigger === "string" && memory.trigger !== "") {
      lines.push(`trigger: ${memory.trigger}`);
    }

    lines.push(`kind: ${memory.kind ?? "workflow"}`);
    lines.push(
      `confidence: ${typeof memory.confidence === "number" ? String(memory.confidence) : "0.3"}`,
    );

    if (Array.isArray(memory.steps)) {
      for (const step of memory.steps) {
        const action = step && typeof step.action === "string" ? step.action : "";

        if (action === "") continue;

        const truncated =
          action.at(MAX_PERSIST_STEP_CHARS) === undefined
            ? action
            : action.slice(0, MAX_PERSIST_STEP_CHARS);

        lines.push(`- step ${step.order ?? 0}: ${truncated}`);
      }
    }

    if (Array.isArray(memory.preconditions) && memory.preconditions.length > 0) {
      lines.push("preconditions:");
      for (const condition of memory.preconditions) {
        const text = typeof condition === "string" ? condition : "";

        if (text === "") continue;

        lines.push(`- ${text}`);
      }
    }

    if (typeof memory.outcome === "string" && memory.outcome !== "") {
      lines.push(`outcome: ${memory.outcome}`);
    }

    const joined = lines.join("\n");

    if (joined === "") return "";

    if (joined.at(MAX_PERSIST_CONTENT_CHARS) === undefined) return joined;

    return joined.slice(0, MAX_PERSIST_CONTENT_CHARS);
  } catch {
    return "";
  }
}

/**
 * Persists one ProceduralMemory through the existing `saveMemory` write path.
 * Never throws: returns a result object describing what happened. With a
 * saver that returns no `id`, the row is treated as a no-op insert and reported
 * as `persisted_idempotent`, so re-saving the same procedure does not duplicate.
 */
export async function persistProceduralMemory(
  memory: ProceduralMemory,
  userId: string,
  saver?: ProceduralSaver,
): Promise<ProceduralPersistResult> {
  const title = buildTitle(memory);

  try {
    if (!isUuidLike(userId)) {
      return {
        status: "skipped",
        reason: "invalid_request",
        title,
        id: null,
      };
    }

    const writeSaver = await loadSaver(saver);

    if (!writeSaver) {
      return {
        status: "skipped",
        reason: "save_memory_unavailable",
        title,
        id: null,
      };
    }

    const content = buildContent(memory);

    if (content === "") {
      return { status: "skipped", reason: "not_procedural", title, id: null };
    }

    let result: unknown;

    try {
      result = await writeSaver({
        userId,
        title,
        content,
        memoryType: "procedural",
        status: PROCEDURAL_MEMORY_STATUS,
        tags: [PROCEDURAL_MEMORY_TAG],
        importance: 5,
        confidence: memory.confidence ?? 0.6,
        explicit: false,
        source: PROCEDURAL_MEMORY_SOURCE,
        sourceRef: PROCEDURAL_SOURCE_REF,
      });
    } catch {
      return { status: "failed", reason: "save_memory_error", title, id: null };
    }

    const id = (result as { id?: string } | null | undefined)?.id ?? null;

    return {
      status: typeof id === "string" ? "persisted" : "persisted_idempotent",
      reason: null,
      title,
      id: typeof id === "string" ? id : null,
    };
  } catch {
    return {
      status: "skipped",
      reason: "invalid_request",
      title: buildTitle(memory),
      id: null,
    };
  }
}

/**
 * Generates a procedural memory and, when `persist` is true, persists it
 * through the existing memory write path. Never throws: any failure is folded
 * into the outcome. The model is never called and nothing is written when the
 * flag is off.
 */
export async function extractAndPersistProcedural(
  request: ProceduralRequest,
  deps: ExtractAndPersistProceduralDeps = {},
): Promise<ExtractAndPersistProceduralOutcome> {
  try {
    const outcome = await extractOrDefer(request, deps);

    if (outcome.kind !== "extracted") {
      return { kind: "deferred", reason: outcome.reason, persistence: null };
    }

    if (!deps.persist) {
      return { kind: "extracted", memory: outcome.memory, persistence: null };
    }

    const persistence = await persistProceduralMemory(
      outcome.memory,
      extractUserId(request),
      deps.saver,
    );

    return { kind: "extracted", memory: outcome.memory, persistence };
  } catch {
    return { kind: "deferred", reason: "invalid_request", persistence: null };
  }
}

/** Reads the owner id from the request. Never throws. */
function extractUserId(request: ProceduralRequest): string {
  try {
    const userId = (
      request as unknown as Record<string, unknown> | null | undefined
    )?.["userId"];

    return typeof userId === "string" ? userId : "";
  } catch {
    return "";
  }
}
