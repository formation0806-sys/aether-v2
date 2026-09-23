/** Agent turn trace.

 * Records content-free timing and phase information for the agent loop.
 * Never touches message, memory, or observation text — the loop injects
 * only tool names, phase labels, timings, and outcomes.
 *
 * Pure and side-effect free: every function takes the current trace state
 * and returns a new trace state.  No I/O, no clock access in the hot path
 * (the caller reads performance.now or Date.now and passes the delta), and
 * no feature-flag inspection.
 *
 * This module is not wired into the chat route in this step; it exists so
 * the loop can record a turn's trace once the loop is built.  Nothing here
 * is imported by production code yet.
 */

/** A phase in the agent loop. Mirrors AgentTracePhase in types.ts. */
export type TracePhase = "think" | "act" | "observe" | "final" | "error";

/** One step in a turn trace. Mirrors AgentTraceStep in types.ts. */
export interface TraceStep {
  /** Monotonic 1-based index within the turn. */
  step: number;
  phase: TracePhase;
  /** Tool name for act and observe steps. Absent for think, final, and error. */
  tool?: string;
  /** Milliseconds spent in this step. Always present. */
  durationMs: number;
  /** Whether the step succeeded. Absent for planning-only steps. */
  ok?: boolean;
  /** Short, content-free note, for example "invalid_tool_args". */
  note?: string;
}

/** A complete turn trace: the ordered steps recorded for one agent turn. */
export interface TurnTrace {
  /** All steps recorded so far, in order. */
  steps: TraceStep[];
}

/** Phase→step kind mapping helpers. */

/** Whether a phase is a tool-invocation phase that carries a tool name. */
export function isToolPhase(phase: TracePhase): boolean {
  return phase === "act" || phase === "observe";
}

/** Whether a phase can record a success/fail outcome. */
export function phaseRecordsOutcome(phase: TracePhase): boolean {
  return phase === "act" || phase === "observe" || phase === "error";
}

/** Validates a phase label. Returns false for unknown strings so the caller
 * can fall back to "error" or reject the input. */
export function isValidPhase(value: string): value is TracePhase {
  return (
    value === "think" ||
    value === "act" ||
    value === "observe" ||
    value === "final" ||
    value === "error"
  );
}
/** Builds a fresh, empty turn trace. */
export function emptyTrace(): TurnTrace {
  return { steps: [] };
}
/** Adds a step to a trace and returns a new trace. Does not mutate the input.

 * The step number is derived from the current length so callers never have to
 * track their own counter. The phase is validated: an invalid phase produces
 * an "error" step so a malformed loop never drops observability.
 *
 * Notes are accepted but never inspected; they are stored verbatim and may be
 * anything the loop chooses to record, as long as it is content-free.
 */
export function addStep(
  trace: TurnTrace,
  phase: TracePhase | string,
  durationMs: number,
  opts?: {
    tool?: string;
    ok?: boolean;
    note?: string;
  },
): TurnTrace {
  const rawPhase: TracePhase =
    isValidPhase(phase) ? (phase as TracePhase) : "error";
  const nextIndex = trace.steps.length + 1;
  const step: TraceStep = {
    step: nextIndex,
    phase: rawPhase,
    durationMs,
  };

  if (opts?.tool !== undefined && isToolPhase(rawPhase)) {
    step.tool = opts.tool;
  }

  if (opts?.ok !== undefined && phaseRecordsOutcome(rawPhase)) {
    step.ok = opts.ok;
  }

  if (opts?.note !== undefined) {
    step.note = opts.note;
  }

  return { steps: [...trace.steps, step] };
}
/** Marks the last step as final with the given outcome duration.

 * This is a convenience so the loop does not have to remember to close the
 * trace explicitly on the happy path. It is still pure: it returns a new
 * trace and leaves the input unchanged. If the trace is already empty the
 * result is unchanged.
 */
export function finalizeTrace(
  trace: TurnTrace,
  finalDurationMs: number,
): TurnTrace {
  if (trace.steps.length === 0) return trace;

  const last = trace.steps[trace.steps.length - 1];
  const updated = { ...last, durationMs: finalDurationMs };

  return {
    steps: [...trace.steps.slice(0, -1), updated],
  };
}

/** Total duration of all recorded steps, in milliseconds.

 * Summed from step.durationMs. Returns 0 when there are no steps, so callers
 * can always subtract two snapshots without guarding for empty traces.
 */
export function traceDurationMs(trace: TurnTrace): number {
  let total = 0;

  for (const step of trace.steps) {
    total += step.durationMs;
  }

  return total;
}
/** Returns the count of steps whose phase is "error". */
export function errorStepCount(trace: TurnTrace): number {
  let count = 0;

  for (const step of trace.steps) {
    if (step.phase === "error") count += 1;
  }

  return count;
}

/** Returns true when the trace contains at least one failing tool step.

 * A step fails when ok === false. Steps without an ok field are planning steps
 * and do not count as failures.
 */
export function hasFailedToolStep(trace: TurnTrace): boolean {
  for (const step of trace.steps) {
    if (step.phase === "act" || step.phase === "observe") {
      if (step.ok === false) return true;
    }
  }

  return false;
}

/** Finds the last step with the given phase, or undefined when none exists. */
export function lastStepOfPhase(
  trace: TurnTrace,
  phase: TracePhase,
): TraceStep | undefined {
  for (let index = trace.steps.length - 1; index >= 0; index -= 1) {
    if (trace.steps[index].phase === phase) return trace.steps[index];
  }

  return undefined;
}

/** Serializes a trace to a plain object suitable for logging.

 * Still content-free: only phase, tool name, duration, outcome, and note are
 * serialized. No message, memory key, observation text, or other user content
 * is ever included.
 */
export function serializeTrace(
  trace: TurnTrace,
): Array<{
  step: number;
  phase: string;
  tool?: string;
  durationMs: number;
  ok?: boolean;
  note?: string;
}> {
  return trace.steps.map((step) => ({
    step: step.step,
    phase: step.phase,
    tool: step.tool,
    durationMs: step.durationMs,
    ok: step.ok,
    note: step.note,
  }));
}