// ============================================================
// PHASE 6-E — EXPERIMENTAL ARTIFACT (DO NOT USE IN PRODUCTION)
// ============================================================
// Exact copy of the production sanitizeReflection logic from
// lib/memory/reflector.ts:23-65. Copied here so the experiment
// exercises the same acceptance behavior WITHOUT touching the
// production module.
// ============================================================

export function sanitizeReflection(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }

  const r = raw;

  if (typeof r.title !== "string" || typeof r.content !== "string") {
    return null;
  }

  const title = r.title.trim();
  const content = r.content.trim();

  if (!title || !content) {
    return null;
  }

  const memory = {
    title,
    content,
    memoryType: "reflection",
  };

  if (
    typeof r.importance === "number" &&
    Number.isInteger(r.importance) &&
    r.importance >= 1 &&
    r.importance <= 10
  ) {
    memory.importance = r.importance;
  }

  if (
    typeof r.confidence === "number" &&
    r.confidence >= 0 &&
    r.confidence <= 1
  ) {
    memory.confidence = r.confidence;
  }

  return memory;
}
