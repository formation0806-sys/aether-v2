/**
 * Tool registration seam.
 *
 * Mirrors lib/ai/bootstrap.ts and lib/ai/provider.ts: an idempotent per-process
 * initialize plus an accessor. Nothing calls these in production yet, and with
 * every feature flag OFF, which is the default, the resulting registry is empty.
 */

import { calculatorTool } from "./calculator";
import { currentTimeTool } from "./current-time";
import { memorySearchTool } from "./memory-search";
import { blenderTool } from "./blender";
import { ToolRegistry } from "./registry";
import type { FlagPredicate } from "./registry";
import type { ToolDefinition } from "./types";

/**
 * The agent tools available to the loop.
 *
 * `current_time`, `calculator`, and `memory_search` are the original read-only
 * set and remain read-only. `blender` is a controlled, scene-mutating tool: its
 * `create_object` operation changes a live Blender scene through a loopback
 * bridge, so unlike the others it is not read-only. It is still confined to a
 * closed operation allowlist and writes no files.
 *
 * blenderTool is appended last, so the three original tools keep their existing
 * order and stay registered whenever only ENABLE_TOOL_USE is on. Blender
 * additionally requires ENABLE_TOOL_BLENDER, so it can never bypass the global
 * tool flag and is absent from this registry by default.
 */
export const AGENT_TOOLS: ToolDefinition[] = [
  currentTimeTool,
  calculatorTool,
  memorySearchTool,
  blenderTool,
];

/**
 * Builds a fresh registry containing the v1 tools.
 *
 * Pure: no global state, so tests can call it with an injected flag predicate.
 * With flags OFF every registration is refused by the registry, and the result is
 * an empty registry, which is what production sees today.
 */
export function buildAgentToolRegistry(
  isFlagEnabled?: FlagPredicate
): ToolRegistry {
  const registry = new ToolRegistry(isFlagEnabled);

  for (const tool of AGENT_TOOLS) {
    registry.register(tool);
  }

  return registry;
}

let initialized = false;
let registry: ToolRegistry | null = null;

/** Idempotent per-process bootstrap, mirroring initializeAI(). */
export function initializeTools(): void {
  if (initialized) return;

  registry = buildAgentToolRegistry();

  initialized = true;
}

/** Mirrors getProvider(): it throws only when initializeTools() has not run. */
export function getToolRegistry(): ToolRegistry {
  if (registry === null) {
    throw new Error("Tool registry has not been initialized.");
  }

  return registry;
}