import { Runtime } from "./runtime";

import { buildContext } from "@/lib/context";
import { buildBrain } from "@/lib/brain";
import {
  saveAssistantMessage,
  buildConversation,
} from "@/lib/ai/conversation/manager";
import { createMessageWithJob } from "@/lib/repositories/conversation.repository";
import {
  claimMemoryJobs,
  completeMemoryJob,
  failMemoryJob,
  reclaimStaleMemoryJobs,
  shouldDeadLetter,
  DEFAULT_CLAIM_BATCH,
  DEFAULT_LEASE_SECONDS,
} from "@/lib/repositories/memory-job.repository";
import { getProvider } from "@/lib/ai/provider";
import { aiExtractMemories } from "@/lib/memory/aiExtractor";
import { saveMemory } from "@/lib/memory/memory";
import { generateReflections } from "@/lib/memory/reflector";
import {
  corroborateMemory,
  getAllMemories,
  purgeArchived,
} from "@/lib/repositories/memory.repository";
import { resolveMemoryIdentity } from "@/lib/memory/identity";
import type { MemoryIdentityDecision } from "@/lib/memory/identity";
import { evaluateLifecycle } from "@/lib/memory/lifecycle";
import {
  validateReflectionGrounding,
  measureSemanticSupport,
} from "@/lib/memory/reflection-grounding";
import type { ChatMessage } from "@/lib/ai/types";

/**
 * Outcome of a single maintenance stage. `ok` is false only when the stage
 * threw; a deliberately-skipped stage (e.g. extraction blocked by the memory
 * gate) remains `ok: true`.
 */
export interface MaintenanceStage {
  ok: boolean;
  error?: string;
  /** F3: extraction stage only — dead-letter the job when saves failed. */
  deadLetter?: boolean;
  /** F3: extraction stage only — per-memory save failures (title + error). */
  saveFailures?: Array<{ title: string; error: string }>;
}

/**
 * Structured result returned by `runMemoryMaintenance(...)` so callers can
 * distinguish "all stages succeeded" from "a stage failed but the function
 * returned normally" (the previous implementation only logged failures).
 * One stage failure does not prevent the other stages from running.
 */
export interface MemoryMaintenanceResult {
  ok: boolean;
  extraction: MaintenanceStage;
  reflection: MaintenanceStage;
  lifecycle: MaintenanceStage;
  purge: MaintenanceStage;
}

const MEMORY_GATE_SKIP = new Set([
  "hi",
  "hello",
  "hey",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "cool",
  "nice",
  "yes",
  "no",
  "good morning",
  "good night",
  "bye",
  "lol",
  "haha",
]);

function shouldExtractMemory(message: string): boolean {
  const t = message.trim().toLowerCase();

  if (t.length < 15) return false;

  return !MEMORY_GATE_SKIP.has(t);
}

/* -------------------------------------------------------------------------- */
/* Phase 1-B: supplementary cross-type reflection window                       */
/* -------------------------------------------------------------------------- */

/** Hard cap on memories placed in the supplementary cross-type window. */
const REFLECTION_WINDOW_MAX_MEMORIES = 12;

/**
 * Serialized-size budget for the window group JSON. Derived from the
 * reflector's num_ctx (4096) minus the system prompt and num_predict (300)
 * headroom, at the ~4 chars/token estimate used by the Phase 6-N audit.
 * lib/memory/constants.ts is frozen; this budget lives locally here.
 */
const REFLECTION_WINDOW_MAX_JSON_CHARS = 6000;

/**
 * Label for the supplementary cross-type window group. Deliberately NOT a
 * MemoryType — it honestly marks a mixed-type generation operation.
 */
const CROSS_TYPE_WINDOW_LABEL = "cross-type";

/** Maps a memory row to the ReflectionInput item shape (shared by type groups and the window). */
function toReflectionInputItem(memory: {
  id: string;
  title: string;
  content: string;
  summary: string;
  importance_v2?: number | null;
  confidence_v2?: number | null;
  memory_type: string;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
}) {
  return {
    id: memory.id,
    title: memory.title,
    content: memory.content,
    summary: memory.summary,
    importance: memory.importance_v2,
    confidence: memory.confidence_v2,
    memoryType: memory.memory_type,
    tags: memory.tags,
    metadata: memory.metadata,
  };
}

/**
 * Phase 1-B: builds the ONE bounded supplementary cross-type window from the
 * eligible candidate pool (the Phase 1-A guard already excludes reflections).
 *
 * - Deterministic ranking: importance_v2 DESC, confidence_v2 DESC,
 *   created_at ASC, id ASC (total order — id is unique).
 * - Hard member cap, then a hard serialized-size budget: the ranked prefix
 *   is accumulated while it fits; trailing members are dropped (and an
 *   oversized single leading member cannot enter at all).
 * - Requires >= 2 members AND >= 2 distinct memory types (structural RULE 7
 *   floor); otherwise returns null and no window group is appended.
 */
function buildCrossTypeWindow<T extends {
  id: string;
  title: string;
  content: string;
  summary: string;
  memory_type: string;
  importance_v2?: number | null;
  confidence_v2?: number | null;
  created_at?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
}>(candidates: T[]): T[] | null {
  if (candidates.length < 2) return null;

  // Deterministic total order: importance DESC, confidence DESC,
  // created_at ASC, id ASC (id is unique, so ties are impossible).
  const ranked = [...candidates].sort((a, b) => {
    const ia = a.importance_v2 ?? 0;
    const ib = b.importance_v2 ?? 0;
    if (ia !== ib) return ib - ia;

    const ca = a.confidence_v2 ?? 0;
    const cb = b.confidence_v2 ?? 0;
    if (ca !== cb) return cb - ca;

    const ta = a.created_at ?? "";
    const tb = b.created_at ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const windowMembers = ranked.slice(0, REFLECTION_WINDOW_MAX_MEMORIES);

  // Serialized-size budget: accumulate the ranked prefix while it fits;
  // the first member that would overflow stops accumulation (an oversized
  // single leading member therefore cannot enter the window at all).
  const picked: T[] = [];
  for (const memory of windowMembers) {
    const probe = [...picked, memory];
    const size = JSON.stringify({
      memoryType: CROSS_TYPE_WINDOW_LABEL,
      memories: probe.map(toReflectionInputItem),
    }).length;
    if (size > REFLECTION_WINDOW_MAX_JSON_CHARS) break;
    picked.push(memory);
  }

  // Structural RULE 7 floor: >= 2 members AND >= 2 distinct types.
  if (picked.length < 2) return null;
  if (new Set(picked.map((m) => m.memory_type)).size < 2) return null;

  return picked;
}

async function runReflection(userId: string) {
  const { data: memories, error } = await getAllMemories(userId);

  if (error) {
    console.error("REFLECTION LOAD FAILED", error);
    return;
  }

  const safeMemories = memories ?? [];

  console.log("REFLECTION MEMORIES", safeMemories.length);

  // Phase 1-A loop guard: reflection memories remain normal memories for
  // retrieval/context, but must never become seeds of further reflection.
  // Without this exclusion the eligibility gate below structurally re-feeds
  // saved reflections into runReflection() (Phase 6-O: no depth guard).
  const reflectionCandidates = safeMemories.filter(
    (m) =>
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5 &&
      m.memory_type !== "reflection"
  );

  console.log(
    "REFLECTION CANDIDATES",
    reflectionCandidates.length
  );

  const reflectionGroups = reflectionCandidates.reduce(
    (groups, memory) => {
      const type = memory.memory_type;

      if (!groups[type]) {
        groups[type] = [];
      }

      groups[type].push(memory);

      return groups;
    },
    {} as Record<string, typeof reflectionCandidates>
  );

  console.log(
    "REFLECTION GROUPS",
    Object.keys(reflectionGroups).length
  );

  const reflectionInput = Object.entries(reflectionGroups).map(
    ([memoryType, memories]) => ({
      memoryType,
      memories: memories.map(toReflectionInputItem),
    })
  );

  // Phase 1-B: append at most ONE bounded supplementary cross-type window.
  // The per-type grouping above is byte-identical to the pre-1-B contract.
  const crossTypeWindow = buildCrossTypeWindow(reflectionCandidates);
  if (crossTypeWindow) {
    reflectionInput.push({
      memoryType: CROSS_TYPE_WINDOW_LABEL,
      memories: crossTypeWindow.map(toReflectionInputItem),
    });
    console.log(
      "REFLECTION CROSS-TYPE WINDOW",
      crossTypeWindow.length
    );
  }

  console.log(
    "REFLECTION INPUT GROUPS",
    reflectionInput.length
  );

  if (reflectionInput.length === 0) {
    console.log("REFLECTION SKIPPED: no input groups");
    return;
  }

  try {
    const reflections = await generateReflections(reflectionInput);

    if (reflections.length === 0) {
      console.log("REFLECTION GENERATED 0");
      return;
    }

    console.log(
      "REFLECTION GENERATED",
      reflections.length
    );

    // Phase 1-A provenance: persist the candidate source memories that were
    // supplied to this generation operation. The reflection output contract
    // forbids model-side citation, so this is operation-level provenance
    // (the exact candidate set passed to generateReflections above), not
    // claim-level attribution. Stored via the existing metadata JSONB —
    // no schema, repository, or type-contract change.
    const generatedAt = new Date().toISOString();
    const sourceMemoryIds = reflectionCandidates.map((memory) => memory.id);

    for (const reflection of reflections) {
      try {
        // Phase 1-B grounding gate: the previously prompt-only rules
        // (RULE 7 / RULE 12 proxies) are now enforced in code. Rejected
        // reflections are logged with a safe reason and never persisted.
        const grounding = validateReflectionGrounding({
          reflectionContent: reflection.content,
          sourceMemoryIds,
          candidateMemories: reflectionCandidates.map((memory) => ({
            id: memory.id,
            content: memory.content,
          })),
        });

        if (!grounding.ok) {
          console.log(
            "REFLECTION_REJECTED_GROUNDING",
            grounding.reason
          );
          continue;
        }

        // Phase 1-C Step 5: Shadow-mode semantic support (observational only).
        // Runs AFTER R1/R2/R3 grounding validation and BEFORE persistence.
        // NEVER rejects or alters the reflection path — non-enforcing.
        try {
          const shadow = await measureSemanticSupport(
            reflection.content,
            sourceMemoryIds,
            userId
          );
          console.log("REFLECTION_SEMANTIC_SUPPORT", {
            min: shadow.minSimilarity,
            mean: shadow.meanSimilarity,
            measuredCount: shadow.measuredCount,
            unmeasuredCount: shadow.unmeasuredCount,
          });
        } catch (e) {
          // Shadow measurement failure is non-fatal: it is observational only
          // and must never block or alter the reflection save path.
          console.error(
            "REFLECTION_SEMANTIC_SUPPORT_FAILED",
            (e as Error)?.message
          );
        }

        await saveMemory({
          userId,
          title: reflection.title,
          content: reflection.content,
          memoryType: "reflection",
          importance: reflection.importance,
          confidence: reflection.confidence,
          source: "reflection",
          sourceRef: null,
          metadata: { sourceMemoryIds, generatedAt },
        });
      } catch (e) {
        console.error("REFLECTION SAVE FAILED", e);
      }
    }
  } catch (e) {
    console.error("REFLECTION GENERATION FAILED", e);
  }
}

/**
 * Runs all non-user-facing memory maintenance work.
 *
 * This is deliberately separated from the response path so that
 * memory extraction, reflection, lifecycle evaluation and archive
 * purging do not delay the user's response.
 */
export async function runMemoryMaintenance(
  userId: string,
  message: string,
  messageId?: string
) {
  console.time("BACKGROUND MEMORY");

  let didExtractMemory = false;

  // F3: individual memory-save failures must be observable. Collected per
  // memory and surfaced on result.extraction so the job worker can dead-letter
  // with last_error instead of reporting completion.
  const extractionSaveFailures: Array<{ title: string; error: string }> = [];

  console.time("Extract memories");

    const result: MemoryMaintenanceResult = {
    ok: true,
    extraction: { ok: true },
    reflection: { ok: true },
    lifecycle: { ok: true },
    purge: { ok: true },
  };

  if (!shouldExtractMemory(message)) {
    console.log("MEMORY GATE: skipped");
  } else {
    try {
      const memories = await aiExtractMemories(message);

      didExtractMemory = memories.length > 0;

      console.log(
        "MEMORIES EXTRACTED",
        memories.length
      );

        for (const memory of memories) {
          try {
          // Identity resolution gates whether this extraction is a genuinely
          // NEW fact (-> saveMemory) or a re-observation of an EXISTING fact
          // (-> corroboration). Corroboration grows confidence_v2 via the
          // existing corroboration RPC; for the corroboration branch we must
          // NOT insert a duplicate memory, so saveMemory is skipped.
          if (messageId) {
            let identityDecision: MemoryIdentityDecision | null = null;
            try {
              identityDecision = await resolveMemoryIdentity({
                userId,
                title: memory.title,
                content: memory.content,
                memoryType: memory.memoryType ?? "semantic",
              });
            } catch (e) {
              // Fail-safe: if identity resolution cannot run, treat the
              // memory as new and save it as today. Never block extraction
              // on an identity-resolution failure.
              console.error("MEMORY IDENTITY RESOLUTION FAILED", e);
              identityDecision = null;
            }

            if (identityDecision?.decision === "corroborate") {
              // Same fact observed again -> grow confidence through the
              // existing RPC (target = existing memory, observation = message).
              // The RPC owns +0.05 / idempotency / ceiling. Do NOT mutate
              // confidence_v2 here; do NOT saveMemory (avoids a duplicate).
              await corroborateMemory(identityDecision.targetId, messageId);
              continue;
            }
          }

          await saveMemory({
            userId,
            title: memory.title,
            content: memory.content,
            memoryType: memory.memoryType,
            importance: memory.importance,
            confidence: memory.confidence,
            explicit: memory.explicit,
            sourceRef: null,
            projectId: null,
            metadata: {},
            observationId: messageId,
          });
        } catch (e) {
          // F3: record the failure — the job must not report success while a
          // memory save silently failed. Fail-safe: sibling saves continue.
          const saveError = e instanceof Error ? e.message : String(e);
          console.error("MEMORY SAVE FAILED", {
            title: memory.title,
            error: saveError,
          });
          extractionSaveFailures.push({
            title: memory.title,
            error: saveError,
          });
        }
      }
    } catch (e) {
      console.error(
        "MEMORY EXTRACTION FAILED",
        e
      );
      result.extraction.ok = false;
      result.extraction.error =
        e instanceof Error ? e.message : String(e);
    }
  }

  if (extractionSaveFailures.length > 0) {
    // F3: surface save failures on the extraction stage. The worker marks the
    // job failed/dead-lettered with last_error (no auto-retry: re-extraction
    // is LLM-nondeterministic and could duplicate memories).
    result.extraction.ok = false;
    result.extraction.saveFailures = extractionSaveFailures;
    result.extraction.deadLetter = true;
    result.extraction.error = `memory save failures: ${extractionSaveFailures
      .map((f) => `${f.title}: ${f.error}`)
      .join("; ")}`;
  }

  console.timeEnd("Extract memories");

  if (didExtractMemory) {
    try {
      await runReflection(userId);
    } catch (error) {
      console.error(
        "REFLECTION FAILED",
        error
      );
      result.reflection.ok = false;
      result.reflection.error =
        error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const lifecycleResult =
      await evaluateLifecycle(userId);

    if (lifecycleResult.transitions.length > 0) {
      console.log(
        "LIFECYCLE TRANSITIONS",
        lifecycleResult.transitions.length
      );
    }
  } catch (lifecycleError) {
    console.error(
      "LIFECYCLE EVALUATION FAILED",
      lifecycleError
    );
    result.lifecycle.ok = false;
    result.lifecycle.error =
      lifecycleError instanceof Error
        ? lifecycleError.message
        : String(lifecycleError);
  }

  try {
    const purgeResult =
      await purgeArchived(userId);

    if (purgeResult.count > 0) {
      console.log(
        "PURGED ARCHIVED",
        purgeResult.count
      );
    }
  } catch (purgeError) {
    console.error(
      "PURGE ARCHIVED FAILED",
      purgeError
    );
    result.purge.ok = false;
    result.purge.error =
      purgeError instanceof Error ? purgeError.message : String(purgeError);
  }

  result.ok =
    result.extraction.ok &&
    result.reflection.ok &&
    result.lifecycle.ok &&
    result.purge.ok;

  console.timeEnd("BACKGROUND MEMORY");

  return result;
}

/**
 * Process this user's due memory-maintenance jobs durably.
 *
 * Sequence:
 *   1. reclaim stale `processing` jobs (lease expiry)
 *   2. claim due `pending` jobs (SQL increments `attempts` + flips to processing)
 *   3. process each claimed job via `runMemoryMaintenance(user_id, message, messageId)`
 *   4. complete jobs whose maintenance `ok === true`
 *   5. fail (dead-letter or reschedule) jobs whose maintenance `ok === false`
 *
 * Per-job isolation: a failure on one job does not prevent the others from
 * being claimed/completed. `attempts` is read from the DB (never incremented
 * here); `next_retry_at` is computed by `fail_memory_job` (never here).
 *
 * This is the Phase 3 entry point; the route will call it from `after(...)`
 * in Phase 4.
 */
export async function processMemoryJobs(userId: string): Promise<void> {
  // 1. Reclaim stale processing jobs so abandoned/crashed workers free them up.
  const { data: reclaimed, error: reclaimError } =
    await reclaimStaleMemoryJobs(userId, DEFAULT_LEASE_SECONDS);

  if (reclaimError) {
    // infrastructure error: log it (visible), but still attempt to claim +
    // process any due work; a follow-up claim failure will surface separately.
    console.error("MAINTENANCE RECLAIM FAILED", { userId, error: reclaimError });
  } else if ((reclaimed ?? 0) > 0) {
    console.log("MAINTENANCE RECLAIMED", { userId, reclaimed });
  }

  // 2. Claim due pending jobs (single SQL concurrency boundary).
  const { data: jobs, error: claimError } =
    await claimMemoryJobs(userId, DEFAULT_CLAIM_BATCH);

  if (claimError) {
    console.error("MAINTENANCE CLAIM FAILED", { userId, error: claimError });
    return;
  }

  const claimed = jobs ?? [];
  if (claimed.length === 0) {
    return;
  }

  console.log("MAINTENANCE CLAIMED", { userId, jobs: claimed.length });

  // 3-5. Process each claimed job in isolation.
  for (const job of claimed) {
    const message = (job.payload?.message as string | undefined) ?? undefined;
    // provenance invariant: job.message_id -> runMemoryMaintenance -> saveMemory(observationId).
    const messageId = job.message_id ?? undefined;
    const attempts = job.attempts;

    console.log("MAINTENANCE PROCESSING", {
      userId,
      jobId: job.id,
      messageId,
      attempts,
    });

    if (!message || !messageId) {
      // Cannot process without provenance -> dead-letter immediately.
      const deadLetter = shouldDeadLetter(attempts);
      const { error: failError } = await failMemoryJob(
        job.id,
        "missing payload.message or job.message_id",
        deadLetter
      );
      if (failError) {
        console.error("MAINTENANCE FAIL FAILED", {
          userId,
          jobId: job.id,
          error: failError,
        });
      } else {
        console.log(
          deadLetter ? "MAINTENANCE DEAD-LETTERED" : "MAINTENANCE FAILED",
          { userId, jobId: job.id, attempts, reason: "missing payload.message or job.message_id" }
        );
      }
      continue;
    }

    let result: MemoryMaintenanceResult;
    try {
      result = await runMemoryMaintenance(
        job.user_id,
        message,
        messageId
      );
    } catch (e) {
      // runMemoryMaintenance surfaces stage failures via result.ok, but an
      // unexpected throw here is still a job failure.
      const error = e instanceof Error ? e.message : String(e);
      const deadLetter = shouldDeadLetter(attempts);
      const { error: failError } = await failMemoryJob(
        job.id,
        error,
        deadLetter
      );
      if (failError) {
        console.error("MAINTENANCE FAIL FAILED", {
          userId,
          jobId: job.id,
          error: failError,
        });
      } else {
        console.log(
          deadLetter ? "MAINTENANCE DEAD-LETTERED" : "MAINTENANCE FAILED",
          { userId, jobId: job.id, attempts, error }
        );
      }
      continue;
    }

    if (result.ok) {
      // 4. Success path.
      const { error: completeError } = await completeMemoryJob(job.id);
      if (completeError) {
        console.error("MAINTENANCE COMPLETE FAILED", {
          userId,
          jobId: job.id,
          error: completeError,
        });
        // Leave the job `processing`; reclaimStaleMemoryJobs will retry it.
        // Do NOT mark it completed on a complete-rpc failure.
        continue;
      }
      console.log("MAINTENANCE COMPLETED", {
        userId,
        jobId: job.id,
        messageId,
      });
      continue;
    }

    // 5. Failure path: dead-letter or reschedule (SQL owns backoff).
    const failedStages = ["extraction", "reflection", "lifecycle", "purge"]
            .map((stage) => result[stage as keyof MemoryMaintenanceResult] as MaintenanceStage)
      .filter((s) => !s.ok)
      .map((s) => (s.error ? `${s.error}` : "stage error"))
      .join("; ");

    // F3: extraction-stage save failures dead-letter immediately (no auto
    // retry — re-extraction is LLM-nondeterministic and could duplicate).
    const deadLetter =
      shouldDeadLetter(attempts) || result.extraction.deadLetter === true;
    const { error: failError } = await failMemoryJob(
      job.id,
            `maintenance failed: ${failedStages || "unknown"}`,
      deadLetter
    );

    if (failError) {
      console.error("MAINTENANCE FAIL FAILED", {
        userId,
        jobId: job.id,
        error: failError,
      });
    } else {
      console.log(
        deadLetter ? "MAINTENANCE DEAD-LETTERED" : "MAINTENANCE FAILED",
        { userId, jobId: job.id, attempts }
      );
    }
  }
}

export async function runPipeline(runtime: Runtime) {
  console.time("TOTAL");

  const state = runtime.get();

  console.time("Context");

  const context = await buildContext(
    state.userId,
    state.message
  );

  console.timeEnd("Context");

  runtime.update({ context });

  console.time("Brain");

  const brain = await buildBrain({
    message: state.message,
    context,
  });

  console.timeEnd("Brain");

  runtime.update({
    prompt: brain.prompt,
  });

    console.time("Save User");

  // Atomic durable enqueue: persist the user message AND enqueue a
  // memory-maintenance job for it in one RPC transaction (migration 0013).
  // This happens BEFORE the LLM call so the job exists even if generation
  // fails -> the route can return a 500 while message + job survive.
  const messageId = await createMessageWithJob(
    state.userId,
    state.message
  );
    runtime.update({ messageId: messageId ?? undefined });

  console.timeEnd("Save User");

  console.time("Conversation");

  const conversation =
    await buildConversation(state.userId);

  console.timeEnd("Conversation");

  conversation.unshift({
    role: "system",
    content: brain.prompt,
  });

  // CRITICAL: explicitly append the current user message to ensure the
  // model always sees it, independent of DB persistence success.
  conversation.push({
    role: "user",
    content: state.message,
  });

  const ai = getProvider();

  console.time("LLM");

  const response = await ai.chat(
    conversation
  );

  console.timeEnd("LLM");

  console.time("Save Assistant");

  await saveAssistantMessage(
    state.userId,
    response
  );

  console.timeEnd("Save Assistant");

  runtime.update({
    response,
  });

    console.timeEnd("TOTAL");

  return runtime.get();
}

/* -------------------------------------------------------------------------- */
/* Streaming pipeline (LATENCY-03)                                            */
/* -------------------------------------------------------------------------- */

/** Result of the pre-LLM phase — everything that must finish before the model
 *  stream begins.  The user message and maintenance job are persisted here,
 *  so a model failure still leaves durable provenance.
 */
export interface PreStreamResult {
  userId: string;
  messageId: string | undefined;
  conversationId: string | null;
  conversation: ChatMessage[];
  prompt: string;
}

/**
 * Steps 1–4 of the pipeline — context assembly, brain/prompt building,
 * durable user-message + job persistence, and conversation history
 * construction.  Returns the data the route needs to start streaming the
 * LLM response.
 *
 * This is the streaming counterpart of runPipeline: it performs every
 * side-effecting pre-LLM step but deliberately does NOT call the provider.
 */
export async function preStreamPipeline(
  runtime: Runtime
): Promise<PreStreamResult> {
  console.time("TOTAL");

  const state = runtime.get();

  console.time("Context");
  const context = await buildContext(state.userId, state.message);
  console.timeEnd("Context");
  runtime.update({ context });

  console.time("Brain");
  const brain = await buildBrain({
    message: state.message,
    context,
  });
  console.timeEnd("Brain");
  runtime.update({ prompt: brain.prompt });

  // Atomic durable enqueue: persist the user message AND enqueue a
  // memory-maintenance job for it in one RPC transaction (migration 0013).
  // This happens BEFORE the LLM stream begins so the job exists even if
  // generation fails — the route can return an error while message + job survive.
  console.time("Save User");
  const messageId = await createMessageWithJob(
    state.userId,
    state.message,
    state.conversationId ?? null
  );
  runtime.update({ messageId: messageId ?? undefined });
  console.timeEnd("Save User");

  console.time("Conversation");
  const conversation = await buildConversation(state.userId, state.conversationId ?? null);
  console.timeEnd("Conversation");

  conversation.unshift({
    role: "system",
    content: brain.prompt,
  });

  // CRITICAL: The current user message must be the last message in the
  // conversation array sent to the model. We append it explicitly here
  // (not via buildConversation/getHistory) because the database insert
  // via createMessageWithJob may fail in production (e.g. RPC schema
  // mismatch), and the model must still see and answer the current
  // message regardless of persistence success. The DB insert above is
  // still attempted for durability/memory-job purposes.
  conversation.push({
    role: "user",
    content: state.message,
  });

  return {
    userId: state.userId,
    messageId: messageId ?? undefined,
    conversationId: state.conversationId ?? null,
    conversation,
    prompt: brain.prompt,
  };
}

/**
 * Create an SSE-readable ReadableStream that:
 *   1. Calls getProvider().chatStream() (Ollama with stream:true)
 *   2. Wraps each content chunk as an SSE `data:` event
 *   3. Calls saveAssistantMessage() EXACTLY ONCE after the stream ends
 *   4. Emits a final `done` SSE event
 *
 * Persistence semantics preserved:
 *   - User message + memory job persisted in preStreamPipeline BEFORE this runs
 *   - Assistant message persisted exactly once AFTER stream completion
 *   - On stream abort/failure: assistant message is NOT saved
 *
 * Error safety:
 *   - Never exposes API keys, auth headers, env vars, or stack traces
 *   - Only a generic "An error occurred during streaming" message is sent
 */
export function createChatStream(
  preResult: PreStreamResult
): ReadableStream {
  const { userId, conversation, conversationId } = preResult;

  return new ReadableStream({
    async start(controller) {
      const ai = getProvider();
      let fullResponse = "";

      try {
        const ollamaStream = await ai.chatStream(conversation);
        const reader = ollamaStream.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullResponse += chunk;

          // SSE: data: { JSON }\n\n
          const sseData = `data: ${JSON.stringify(
            { type: "content", data: chunk }
          )}\n\n`;
          controller.enqueue(new TextEncoder().encode(sseData));
        }

        reader.releaseLock();

        // Persist assistant message exactly ONCE after the full stream.
        console.time("Save Assistant");
        await saveAssistantMessage(userId, fullResponse, conversationId ?? null);
        console.timeEnd("Save Assistant");

        // Signal completion to the client.
        const doneData = `data: ${JSON.stringify({ type: "done" })}\n\n`;
        controller.enqueue(new TextEncoder().encode(doneData));
        controller.close();

        console.timeEnd("TOTAL");
      } catch (error) {
        console.error("Streaming error", error);
        // Safe SSE error — no secrets, no stack traces.
        const errData = `data: ${JSON.stringify(
          { type: "error", message: "An error occurred during streaming" }
        )}\n\n`;
        controller.enqueue(new TextEncoder().encode(errData));
        controller.close();
      }
    },
  });
}