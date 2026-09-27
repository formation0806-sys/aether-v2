import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  DEFAULT_PLANNER_MODEL,
  DEFAULT_PROVIDER,
  ROUTER_ENV_VARS,
  SUPPORTED_ROLES,
  getDefaultModelForRole,
  resolveAllRoutes,
  resolveModelRoute,
  type ModelRole,
} from "@/lib/ai/routing";

describe("Model Router Foundation", () => {
  describe("Default Fallback (env unset)", () => {
    it("resolves chat role to default qwen2.5:3b on ollama when env is empty", () => {
      const route = resolveModelRoute("chat", {});
      expect(route).toEqual({
        role: "chat",
        provider: "ollama",
        model: "qwen2.5:3b",
        isOverridden: false,
      });
    });

    it("resolves agent role to default qwen2.5:3b on ollama when env is empty", () => {
      const route = resolveModelRoute("agent", {});
      expect(route).toEqual({
        role: "agent",
        provider: "ollama",
        model: "qwen2.5:3b",
        isOverridden: false,
      });
    });

    it("resolves planner role to default qwen2.5:3b on ollama when env is empty", () => {
      const route = resolveModelRoute("planner", {});
      expect(route).toEqual({
        role: "planner",
        provider: "ollama",
        model: "qwen2.5:3b",
        isOverridden: false,
      });
    });

    it("resolves embed role to default nomic-embed-text:latest on ollama when env is empty", () => {
      const route = resolveModelRoute("embed", {});
      expect(route).toEqual({
        role: "embed",
        provider: "ollama",
        model: "nomic-embed-text:latest",
        isOverridden: false,
      });
    });

    it("matches all individual role constants", () => {
      expect(getDefaultModelForRole("chat")).toBe(DEFAULT_CHAT_MODEL);
      expect(getDefaultModelForRole("agent")).toBe(DEFAULT_AGENT_MODEL);
      expect(getDefaultModelForRole("planner")).toBe(DEFAULT_PLANNER_MODEL);
      expect(getDefaultModelForRole("embed")).toBe(DEFAULT_EMBED_MODEL);
      expect(DEFAULT_PROVIDER).toBe("ollama");
    });

    it("resolveAllRoutes returns default configuration for all roles", () => {
      const all = resolveAllRoutes({});
      for (const role of SUPPORTED_ROLES) {
        expect(all[role].isOverridden).toBe(false);
        expect(all[role].provider).toBe("ollama");
      }
      expect(all.chat.model).toBe("qwen2.5:3b");
      expect(all.agent.model).toBe("qwen2.5:3b");
      expect(all.planner.model).toBe("qwen2.5:3b");
      expect(all.embed.model).toBe("nomic-embed-text:latest");
    });
  });

  describe("Role Overrides", () => {
    it("overrides chat model via AI_MODEL_CHAT", () => {
      const route = resolveModelRoute("chat", {
        [ROUTER_ENV_VARS.chatModel]: "llama3.2:3b",
      });
      expect(route).toEqual({
        role: "chat",
        provider: "ollama",
        model: "llama3.2:3b",
        isOverridden: true,
      });
    });

    it("overrides planner model via AI_MODEL_PLANNER without affecting chat", () => {
      const env = {
        [ROUTER_ENV_VARS.plannerModel]: "deepseek-r1:7b",
      };
      const plannerRoute = resolveModelRoute("planner", env);
      const chatRoute = resolveModelRoute("chat", env);

      expect(plannerRoute).toEqual({
        role: "planner",
        provider: "ollama",
        model: "deepseek-r1:7b",
        isOverridden: true,
      });
      expect(chatRoute.isOverridden).toBe(false);
      expect(chatRoute.model).toBe("qwen2.5:3b");
    });

    it("overrides agent provider via AI_PROVIDER_AGENT", () => {
      const route = resolveModelRoute("agent", {
        [ROUTER_ENV_VARS.agentProvider]: "dummy",
      });
      expect(route).toEqual({
        role: "agent",
        provider: "dummy",
        model: "qwen2.5:3b",
        isOverridden: true,
      });
    });

    it("overrides embed model via AI_MODEL_EMBED", () => {
      const route = resolveModelRoute("embed", {
        [ROUTER_ENV_VARS.embedModel]: "mxbai-embed-large:latest",
      });
      expect(route).toEqual({
        role: "embed",
        provider: "ollama",
        model: "mxbai-embed-large:latest",
        isOverridden: true,
      });
    });

    it("applies generic AI_MODEL_DEFAULT to generation roles when specific role is unset", () => {
      const env = {
        [ROUTER_ENV_VARS.defaultModel]: "mistral:7b",
      };
      expect(resolveModelRoute("chat", env).model).toBe("mistral:7b");
      expect(resolveModelRoute("agent", env).model).toBe("mistral:7b");
      expect(resolveModelRoute("planner", env).model).toBe("mistral:7b");
      expect(resolveModelRoute("embed", env).model).toBe("nomic-embed-text:latest");
    });

    it("prefers specific role override over generic default override", () => {
      const env = {
        [ROUTER_ENV_VARS.defaultModel]: "mistral:7b",
        [ROUTER_ENV_VARS.chatModel]: "qwen2.5-coder:7b",
      };
      expect(resolveModelRoute("chat", env).model).toBe("qwen2.5-coder:7b");
      expect(resolveModelRoute("agent", env).model).toBe("mistral:7b");
    });

    it("applies generic AI_PROVIDER_DEFAULT when role-specific provider is unset", () => {
      const env = {
        [ROUTER_ENV_VARS.defaultProvider]: "dummy",
      };
      expect(resolveModelRoute("chat", env).provider).toBe("dummy");
      expect(resolveModelRoute("planner", env).provider).toBe("dummy");
    });
  });

  describe("Fail-closed & Safety on Invalid Values", () => {
    it("handles whitespace-only and empty strings by falling back to defaults", () => {
      const route = resolveModelRoute("chat", {
        [ROUTER_ENV_VARS.chatModel]: "   ",
        [ROUTER_ENV_VARS.chatProvider]: "",
      });
      expect(route.model).toBe("qwen2.5:3b");
      expect(route.provider).toBe("ollama");
      expect(route.isOverridden).toBe(false);
    });

    it("rejects unknown provider kinds and falls back to default ollama", () => {
      const route = resolveModelRoute("agent", {
        [ROUTER_ENV_VARS.agentProvider]: "some-nonexistent-provider",
      });
      expect(route.provider).toBe("ollama");
      expect(route.model).toBe("qwen2.5:3b");
      expect(route.isOverridden).toBe(false);
    });

    it("handles invalid role parameter safely by defaulting to chat", () => {
      const invalidRole = "nonexistent_role" as unknown as ModelRole;
      const route = resolveModelRoute(invalidRole, {});
      expect(route.role).toBe("chat");
      expect(route.model).toBe("qwen2.5:3b");
      expect(route.provider).toBe("ollama");
    });

    it("never throws even with abnormal input", () => {
      expect(() =>
        resolveModelRoute(
          null as unknown as ModelRole,
          null as unknown as Record<string, string>,
        ),
      ).not.toThrow();
    });
  });

  describe("Purity & Production Safety", () => {
    it("does not mutate the env input argument", () => {
      const env: Record<string, string | undefined> = {
        [ROUTER_ENV_VARS.chatModel]: "test-model",
      };
      const snapshot = { ...env };
      resolveModelRoute("chat", env);
      expect(env).toEqual(snapshot);
    });

    it("live resolution against process.env produces default path unless deliberately set", () => {
      const liveRoute = resolveModelRoute("chat");
      expect(liveRoute.model).toBe("qwen2.5:3b");
      expect(liveRoute.provider).toBe("ollama");
    });
  });
});
