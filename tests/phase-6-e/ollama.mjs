// ============================================================
// PHASE 6-E — EXPERIMENTAL ARTIFACT (DO NOT USE IN PRODUCTION)
// ============================================================
// Direct Ollama /api/chat caller for the controlled experiment.
// Mirrors the production request shape in
// lib/memory/reflector.ts:322-352 (model, stream, options,
// system+user messages). No database access. No production
// configuration is touched.
// ============================================================

export const OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/chat";

export const EXPERIMENT_PARAMS = {
  temperature: 0.1,
  numPredict: 300,
  topP: 0.8,
  numCtx: 4096,
};

export async function callOllama({
  model,
  system,
  user,
  params = EXPERIMENT_PARAMS,
  timeoutMs = 180000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          temperature: params.temperature,
          num_predict: params.numPredict,
          top_p: params.topP,
          num_ctx: params.numCtx,
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }

    const data = await res.json();
    const content =
      typeof data?.message?.content === "string" ? data.message.content : "";

    return { ok: true, content };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}
