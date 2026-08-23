import { createClient } from "@/lib/supabase/server";

/**
 * A single `memory_jobs` row as returned by the `claim_memory_jobs` RPC
 * (`setof memory_jobs`). Field names mirror the Phase 1 schema (migration
 * 0013) in snake_case so callers can read `payload` / `next_retry_at` /
 * `message_id` etc. directly off the rows.
 */
export interface MemoryJob {
  id: string;
  job_type: string;
  user_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  payload: Record<string, unknown> | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  message_id: string | null;
  next_retry_at: string | null;
}

/**
 * Maximum number of times a single job may be claimed before it is
 * dead-lettered.
 *
 * There is intentionally NO `attempt_limit` column in the database
 * (Phase 1 deliberately omitted it). The limit is an application-level
 * decision boundary consumed by Phase 3's `processMemoryJobs` to decide
 * whether `fail_memory_job` should dead-letter (`p_dead_letter = true`)
 * or reschedule.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Default number of due jobs claimed in a single `claim_memory_jobs`
 * sweep. Mirrors the SQL default `p_max int default 5`.
 */
export const DEFAULT_CLAIM_BATCH = 5;

/**
 * Phase 1 lease window (seconds) for `reclaim_stale_memory_jobs`.
 * Must stay in sync with the SQL default.
 */
export const DEFAULT_LEASE_SECONDS = 300;

/**
 * Decide whether a job that has been claimed `attempts` times should be
 * dead-lettered rather than rescheduled.
 *
 * SQL owns the retry backoff (`2^(attempts-1) * 60s`, capped at 3600s in the
 * `fail_memory_job` RPC); this helper only decides the dead-letter boundary
 * using `MAX_ATTEMPTS`. Do NOT recompute `next_retry_at` here.
 */
export function shouldDeadLetter(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

/**
 * Atomically claim up to `max` due `pending` jobs for `userId`.
 *
 * The `claim_memory_jobs` RPC increments `attempts` and flips rows to
 * `processing` inside PostgreSQL with a re-check (`and status = 'pending'`),
 * so concurrent processors cannot double-claim the same job.
 *
 * Returns `{ data, error }` to match the repository convention used by
 * `purgeArchived` / `corroborateMemory`; callers destructure as they do
 * elsewhere in the codebase.
 */
export async function claimMemoryJobs(userId: string, max = DEFAULT_CLAIM_BATCH) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("claim_memory_jobs", {
    p_user_id: userId,
    p_max: max,
  });

  if (error) {
    console.error("CLAIM MEMORY JOBS FAILED", error);
    return { data: null as MemoryJob[] | null, error };
  }

  return { data: (data as MemoryJob[]) ?? [], error };
}

/**
 * Mark a claimed job `processing -> completed`.
 *
 * Returns the RPC's boolean result (`found`). SQL enforces that only rows
 * in `status = 'processing'` owned by this user are touched, so the
 * application-level boolean simply forwards that outcome.
 */
export async function completeMemoryJob(jobId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("complete_memory_job", {
    p_job_id: jobId,
  });

  if (error) {
    console.error("COMPLETE MEMORY JOB FAILED", error);
    return { data: null as boolean | null, error };
  }

  return { data: data === true, error };
}

/**
 * Record that a job failed.
 *
 * The `fail_memory_job` RPC performs the state transition AND the
 * exponential backoff (`2^(attempts-1) * 60s`, capped at 3600s) — the
 * database RPC is the single source of truth for `next_retry_at`. This
 * wrapper does NOT recompute backoff. The application only decides
 * `deadLetter` (`p_dead_letter`), which is the sole branching input.
 *
 * The RPC returns void; callers should treat `error !== null` as failure.
 */
export async function failMemoryJob(
  jobId: string,
  jobError: string,
  deadLetter: boolean
) {
  const supabase = await createClient();

  const { error } = await supabase.rpc("fail_memory_job", {
    p_job_id: jobId,
    p_error: jobError,
    p_dead_letter: deadLetter,
  });

  if (error) {
    console.error("FAIL MEMORY JOB FAILED", error);
    return { error };
  }

  return { error: null as null };
}

/**
 * Requeue `processing` jobs that have exceeded the `leaseSeconds` lease
 * back to `pending` so another worker can claim them. Returns the count
 * of rows reclaimed (the RPC's integer return value).
 */
export async function reclaimStaleMemoryJobs(
  userId: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS
) {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("reclaim_stale_memory_jobs", {
    p_user_id: userId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    console.error("RECLAIM STALE MEMORY JOBS FAILED", error);
    return { data: null as number | null, error };
  }

  return { data: (data as number) ?? 0, error };
}
