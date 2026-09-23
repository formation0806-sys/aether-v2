/**
 * Tool registry.
 *
 * Flag-aware at registration time, never at call time: a tool whose required
 * flags are not enabled is not registered at all, so it cannot be called and is
 * never offered to the model. With every flag off, which is the default, the
 * registry is empty.
 *
 * Nothing imports this module in production yet. The bootstrap that fills it
 * (initializeTools) and the loop that reads it arrive in later steps.
 */

import { isFeatureEnabled } from "@/lib/config/features";
import type { FeatureFlag } from "@/lib/config/features";
import type { ToolDefinition } from "./types";

/**
 * Flag predicate, injectable so tests never depend on process.env. Production
 * callers omit it, which uses isFeatureEnabled unchanged.
 */
export type FlagPredicate = (flag: FeatureFlag) => boolean;

/**
 * Strict positive integer form: rejects 0, negatives, decimals, and non-numeric
 * input. Same rule the numeric feature flags use.
 */
const POSITIVE_INT = /^[1-9][0-9]*$/;

/**
 * Holds the tools that are available for the current process.
 *
 * There is no global instance: the bootstrap creates one, which keeps the
 * registry trivially testable and free of import-time side effects.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly isFlagEnabled: FlagPredicate;

  constructor(isFlagEnabled: FlagPredicate = isFeatureEnabled) {
    this.isFlagEnabled = isFlagEnabled;
  }

  /**
   * Registers a tool when its flags are enabled and its definition is valid.
   *
   * Never throws. An invalid or duplicate definition is skipped and reported as
   * false, because a registration mistake must not be able to break a request.
   * The first registration for a name wins.
   *
   * Registration is side effect free: it never calls parseArgs or execute.
   */
  register(definition: ToolDefinition): boolean {
    if (!isValidDefinition(definition)) return false;

    if (this.tools.has(definition.name)) return false;

    if (!this.areFlagsEnabled(definition.requiredFlags)) return false;

    this.tools.set(definition.name, definition);

    return true;
  }

  /** A registered tool, or undefined when it is unknown or disabled. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Registered tools in registration order. Returns a fresh array. */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  size(): number {
    return this.tools.size;
  }

  private areFlagsEnabled(flags: FeatureFlag[]): boolean {
    for (const flag of flags) {
      if (!this.isFlagEnabled(flag)) return false;
    }

    return true;
  }
}

/**
 * Creates an empty registry. Production callers call this with no argument.
 */
export function createToolRegistry(
  isFlagEnabled?: FlagPredicate
): ToolRegistry {
  return new ToolRegistry(isFlagEnabled);
}

/**
 * Defensive validation. A malformed definition is skipped rather than
 * registered, so a broken tool can never reach the model.
 */
function isValidDefinition(definition: ToolDefinition): boolean {
  if (!definition || typeof definition !== "object") return false;

  if (typeof definition.name !== "string" || definition.name.trim() === "") {
    return false;
  }

  if (
    typeof definition.description !== "string" ||
    definition.description.trim() === ""
  ) {
    return false;
  }

  if (!Array.isArray(definition.requiredFlags)) return false;

  if (
    typeof definition.timeoutMs !== "number" ||
    !POSITIVE_INT.test(String(definition.timeoutMs))
  ) {
    return false;
  }

  if (typeof definition.parseArgs !== "function") return false;

  if (typeof definition.execute !== "function") return false;

  return true;
}