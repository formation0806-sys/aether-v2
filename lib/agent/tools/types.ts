/**
 * Tool contracts for the planned agent loop (docs/AGENT_LOOP_DESIGN.md).
 *
 * Nothing here is imported by production code yet. Every v1 tool is read-only:
 * the only write path in the product remains the existing memory pipeline.
 */

import type { FeatureFlag } from "@/lib/config/features";

/** Execution context handed to every tool call. */
export interface ToolContext {
  userId: string;
  conversationId: string | null;
  /** Epoch milliseconds after which a tool must stop its work. */
  deadline: number;
  /** Aborted when the per-tool timeout elapses or the turn deadline passes. */
  signal: AbortSignal;
}

/** Content-free telemetry about one tool execution. */
export interface ToolCallMeta {
  durationMs: number;
  /** True when the observation was cut to fit the size budget. */
  truncated?: boolean;
}

/** Result of one tool execution. */
export interface ToolResult {
  ok: boolean;
  /** Observation string fed back to the model. Already size-capped by the loop. */
  observation: string;
  meta?: ToolCallMeta;
}

/**
 * Argument parser.
 *
 * Must never throw: return null for any input that is not a valid argument
 * object. The loop turns null into an INVALID_TOOL_ARGS observation and lets the
 * model recover. This mirrors the tolerant parsing already used by the memory
 * extractor, the identity verifier, and the reflector.
 */
export type ToolArgsParser<A> = (raw: unknown) => A | null;

/** Declarative description of one tool. */
export interface ToolDefinition<A = Record<string, unknown>> {
  /** Stable identifier used by the model protocol, for example "current_time". */
  name: string;
  /** One-line description shown in the tool manifest. */
  description: string;
  /**
   * Flags that must all be enabled for the tool to be registered. A tool whose
   * flags are off is absent from the registry: it cannot be called, and it is
   * never mentioned in the prompt. An empty array means always available.
   */
  requiredFlags: FeatureFlag[];
  /** Hard per-call execution budget in milliseconds. */
  timeoutMs: number;
  parseArgs: ToolArgsParser<A>;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}