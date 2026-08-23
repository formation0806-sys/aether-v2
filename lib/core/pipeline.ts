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

/**
 * Outcome of a single maintenance stage. `ok` is false only when the stage
 * threw; a deliberately-skipped stage (e.g. extraction blocked by the memory
 * gate) remains `ok: true`.
 */
export interface MaintenanceStage {
  ok: boolean;
  error?: string;
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

async function runReflection(userId: string) {
  const { data: memories, error } = await getAllMemories(userId);

  if (error) {
    console.error("REFLECTION LOAD FAILED", error);
    return;
  }

  const safeMemories = memories ?? [];

  console.log("REFLECTION MEMORIES", safeMemories.length);

  const reflectionCandidates = safeMemories.filter(
    (m) =>
      (m.status === "active" || m.status === "candidate") &&
      (m.confidence_v2 ?? 0) >= 0.7 &&
      (m.importance_v2 ?? 0) >= 0.5
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
      memories: memories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        content: memory.content,
        summary: memory.summary,
        importance: memory.importance_v2,
        confidence: memory.confidence_v2,
        memoryType: memory.memory_type,
        tags: memory.tags,
        metadata: memory.metadata,
      })),
    })
  );

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

    for (const reflection of reflections) {
      try {
        await saveMemory({
          userId,
          title: reflection.title,
          content: reflection.content,
          memoryType: "reflection",
          importance: reflection.importance,
          confidence: reflection.confidence,
          source: "reflection",
          sourceRef: null,
          metadata: {},
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
          console.error("MEMORY SAVE FAILED", e);
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

    const deadLetter = shouldDeadLetter(attempts);
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