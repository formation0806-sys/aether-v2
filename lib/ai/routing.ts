/**
 * Thin, pure model router for Salpa.
 *
 * Resolves model and provider targets per role (chat, agent, planner, embed)
 * from environment configuration.
 *
 * Guiding design rules:
 * - Pure resolution: no network calls, no database calls, never throws.
 * - Fail-closed: missing, blank, or invalid configuration resolves cleanly
 *   to the existing default local provider and pinned model.
 * - Zero production change: when no router env vars are set, resolving any
 *   role produces the exact default provider ("ollama") and default model
 *   ("qwen2.5:3b" for generation, "nomic-embed-text:latest" for embed).
 * - Additive: callers are not forced to route; foundation is available for
 *   future multi-model, multi-provider wiring.
 */

export type ModelRole = "chat" | "agent" | "planner" | "embed";

export type ProviderKind = "ollama" | "dummy" | "custom";

export interface ResolvedModelRoute {
  readonly role: ModelRole;
  readonly provider: ProviderKind;
  readonly model: string;
  readonly isOverridden: boolean;
}

/** Frozen default models matching existing production behavior. */
export const DEFAULT_CHAT_MODEL = "qwen2.5:3b";
export const DEFAULT_AGENT_MODEL = "qwen2.5:3b";
export const DEFAULT_PLANNER_MODEL = "qwen2.5:3b";
export const DEFAULT_EMBED_MODEL = "nomic-embed-text:latest";

/** Default provider matching existing bootstrap (OllamaProvider). */
export const DEFAULT_PROVIDER: ProviderKind = "ollama";

/** Known roles supported by the router. */
export const SUPPORTED_ROLES: readonly ModelRole[] = Object.freeze([
  "chat",
  "agent",
  "planner",
  "embed",
]);

/** Environment variable names for role model overrides. */
export const ROUTER_ENV_VARS = Object.freeze({
  chatModel: "AI_MODEL_CHAT",
  agentModel: "AI_MODEL_AGENT",
  plannerModel: "AI_MODEL_PLANNER",
  embedModel: "AI_MODEL_EMBED",
  defaultModel: "AI_MODEL_DEFAULT",
  chatProvider: "AI_PROVIDER_CHAT",
  agentProvider: "AI_PROVIDER_AGENT",
  plannerProvider: "AI_PROVIDER_PLANNER",
  embedProvider: "AI_PROVIDER_EMBED",
  defaultProvider: "AI_PROVIDER_DEFAULT",
} as const);

/** Sanitize an env string: returns trimmed string if non-empty, else null. */
function sanitizeEnv(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Sanitize and validate provider kind. Fall back to null if unsupported. */
function sanitizeProvider(value: unknown): ProviderKind | null {
  const raw = sanitizeEnv(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === "ollama" || raw === "dummy" || raw === "custom") {
    return raw;
  }
  return null;
}

/** Get the hard-coded default model for a given role. */
export function getDefaultModelForRole(role: ModelRole): string {
  switch (role) {
    case "embed":
      return DEFAULT_EMBED_MODEL;
    case "chat":
      return DEFAULT_CHAT_MODEL;
    case "agent":
      return DEFAULT_AGENT_MODEL;
    case "planner":
      return DEFAULT_PLANNER_MODEL;
    default:
      return DEFAULT_CHAT_MODEL;
  }
}

/**
 * Resolves the model and provider for a given role.
 *
 * Resolution hierarchy for model:
 * 1. Role-specific override (e.g. AI_MODEL_CHAT)
 * 2. Generic default override (AI_MODEL_DEFAULT) [only for generation roles: chat, agent, planner]
 * 3. Role's built-in default model (e.g. "qwen2.5:3b" or "nomic-embed-text:latest")
 *
 * Resolution hierarchy for provider:
 * 1. Role-specific override (e.g. AI_PROVIDER_CHAT)
 * 2. Generic default override (AI_PROVIDER_DEFAULT)
 * 3. Role's built-in default provider ("ollama")
 *
 * Pure function: accepts an optional env dictionary for testability.
 * Defaults to process.env.
 * Never throws.
 */
export function resolveModelRoute(
  role: ModelRole,
  env: Record<string, string | undefined> = process.env,
): ResolvedModelRoute {
  try {
    const safeRole: ModelRole = SUPPORTED_ROLES.includes(role) ? role : "chat";
    const defaultRoleModel = getDefaultModelForRole(safeRole);

    let roleModelEnvKey: string;
    let roleProviderEnvKey: string;

    switch (safeRole) {
      case "chat":
        roleModelEnvKey = ROUTER_ENV_VARS.chatModel;
        roleProviderEnvKey = ROUTER_ENV_VARS.chatProvider;
        break;
      case "agent":
        roleModelEnvKey = ROUTER_ENV_VARS.agentModel;
        roleProviderEnvKey = ROUTER_ENV_VARS.agentProvider;
        break;
      case "planner":
        roleModelEnvKey = ROUTER_ENV_VARS.plannerModel;
        roleProviderEnvKey = ROUTER_ENV_VARS.plannerProvider;
        break;
      case "embed":
        roleModelEnvKey = ROUTER_ENV_VARS.embedModel;
        roleProviderEnvKey = ROUTER_ENV_VARS.embedProvider;
        break;
    }

    const roleModelOverride = sanitizeEnv(env[roleModelEnvKey]);
    const genericModelOverride =
      safeRole !== "embed" ? sanitizeEnv(env[ROUTER_ENV_VARS.defaultModel]) : null;

    const resolvedModel =
      roleModelOverride ?? genericModelOverride ?? defaultRoleModel;

    const roleProviderOverride = sanitizeProvider(env[roleProviderEnvKey]);
    const genericProviderOverride = sanitizeProvider(
      env[ROUTER_ENV_VARS.defaultProvider],
    );

    const resolvedProvider =
      roleProviderOverride ?? genericProviderOverride ?? DEFAULT_PROVIDER;

    const isOverridden =
      resolvedModel !== defaultRoleModel ||
      resolvedProvider !== DEFAULT_PROVIDER;

    return {
      role: safeRole,
      provider: resolvedProvider,
      model: resolvedModel,
      isOverridden,
    };
  } catch {
    const safeRole: ModelRole =
      typeof role === "string" && (SUPPORTED_ROLES as readonly string[]).includes(role)
        ? role
        : "chat";
    return {
      role: safeRole,
      provider: DEFAULT_PROVIDER,
      model: getDefaultModelForRole(safeRole),
      isOverridden: false,
    };
  }
}

/**
 * Resolves routes for all known roles at once.
 * Pure helper for observability / diagnostics.
 */
export function resolveAllRoutes(
  env: Record<string, string | undefined> = process.env,
): Record<ModelRole, ResolvedModelRoute> {
  return {
    chat: resolveModelRoute("chat", env),
    agent: resolveModelRoute("agent", env),
    planner: resolveModelRoute("planner", env),
    embed: resolveModelRoute("embed", env),
  };
}
