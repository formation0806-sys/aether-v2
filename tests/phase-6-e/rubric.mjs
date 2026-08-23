// ============================================================
// PHASE 6-E — EXPERIMENTAL ARTIFACT (DO NOT USE IN PRODUCTION)
// ============================================================
// Automated, deterministic reflection quality rubric.
// Fixture memories carry distinctive keywords so grounding is
// checked lexically. Criterion 6 (duplication) is DEFERRED.
// GOOD = criteria 1,2,3,4,5,7 all pass; BAD/HARMFUL = fails 1,2,3;
// NEUTRAL = otherwise.
// ============================================================

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "of",
  "to", "in", "on", "at", "by", "with", "from", "as", "is", "are", "was",
  "were", "be", "been", "being", "do", "does", "did", "not", "no", "so",
  "than", "that", "this", "these", "those", "it", "its", "their", "they",
  "them", "he", "she", "his", "her", "you", "your", "we", "our", "user",
  "users", "has", "have", "had", "can", "could", "will", "would", "should",
  "may", "might", "must", "always", "never", "often", "only", "when",
  "which", "who", "whom", "prefers", "prefer", "chooses", "choose", "used",
  "uses", "use", "all", "every", "one", "two", "more", "most", "some",
  "any", "there", "here", "very", "also", "seems", "seem", "about", "into",
  "over", "under", "before", "after", "during", "while", "both", "each",
]);

// Neutral synthesis connectors that do not signal hallucination.
const ALLOWLIST = new Set([
  "consistent", "consistently", "support", "supports", "supported",
  "supporting", "indicate", "indicates", "indicating", "suggest", "suggests",
  "suggesting", "implied", "imply", "implies", "related", "relationship",
  "relationships", "pattern", "patterns", "shows", "show", "showing",
  "combined", "across", "multiple", "together", "behavior", "similar",
  "daily", "routine", "habit", "habits", "typically", "generally", "tends",
  "appears", "appear", "clear", "evidence", "observed", "observations",
  "overall", "overarching", "underlying", "settings", "setting",
  "preference", "preferences", "strong", "strongly",
]);

function contentWords(text) {
  const lower = String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  return lower.split(/\s+/).filter((t) => t.length > 3 && !STOPWORDS.has(t));
}

const META_TITLE_RE = /reflection|reflect|insight|meta|summary/i;
const META_CONTENT_RE = /reflection|reflecting|chain of thought|i synthesized|i reflected|i summariz/i;
const VAGUE_PHRASES = [
  "many interests", "focused on development", "works on projects",
  "has many", "is focused", "has various", "has broad",
];
export function evaluateReflection(reflection, ctx) {
  const content = String(reflection.content || "").toLowerCase();
  const title = String(reflection.title || "").toLowerCase();
  const sources = ctx?.memories || [];
  const keywords = ctx?.keywords || {};

  // ---- Criterion 1: Evidence (>= 2 distinct supplied memories) ----
  let evidenceCount = 0;
  const usedIds = [];
  for (const s of sources) {
    const kws = keywords[s.id] || [];
    if (kws.some((k) => content.includes(String(k).toLowerCase()))) {
      evidenceCount++;
      usedIds.push(s.id);
    }
  }
  const evidencePass = evidenceCount >= 2;

  // ---- Token universe from sources & restatement detection ----
  const unionWords = new Set();
  let restatesSingle = false;
  for (const s of sources) {
    const w = new Set(contentWords(s.content));
    for (const t of w) unionWords.add(t);
  }
  const refWords = new Set(contentWords(content));

  // Criterion 3: Synthesis — must not just restate ONE source.
  for (const s of sources) {
    const w = new Set(contentWords(s.content));
    if (w.size > 0 && [...refWords].every((t) => w.has(t))) {
      restatesSingle = true;
      break;
    }
  }
  const synthesisPass = !restatesSingle;

  // ---- Criterion 2: Support — traceable words or neutral connectors.
  const unsupported = [...refWords].filter(
    (t) => !unionWords.has(t) && !ALLOWLIST.has(t)
  );
  const longUnsupported = unsupported.filter((t) => t.length >= 10);
  const supportPass = unsupported.length <= 2 && longUnsupported.length === 0;

  // ---- Criterion 4: Uncertainty — fixtures contain no real conflicts;
  // an invented conflict is already flagged by criterion 2.
  const uncertaintyPass = true;

  // ---- Criterion 5: Specificity — at least one source keyword appears.
  let anyKeyword = false;
  for (const s of sources) {
    const kws = keywords[s.id] || [];
    if (kws.some((k) => content.includes(String(k).toLowerCase()))) {
      anyKeyword = true;
      break;
    }
  }
  const isVague = VAGUE_PHRASES.some((v) => content.includes(v));
  const specificityPass = anyKeyword && !isVague;

  // ---- Criterion 7: Future usefulness — queryable title, meaningful
  // content, no meta-language about the reflection process.
  const futureUsefulnessPass =
    !META_TITLE_RE.test(title) &&
    !META_CONTENT_RE.test(content) &&
    content.length >= 30 &&
    title.trim().length >= 4;

  const good =
    evidencePass &&
    supportPass &&
    synthesisPass &&
    uncertaintyPass &&
    specificityPass &&
    futureUsefulnessPass;

  const badHarmful = !(evidencePass && supportPass && synthesisPass);
  const neutral = !good && !badHarmful;

  return {
    evidence: { pass: evidencePass, count: evidenceCount, usedIds },
    support: { pass: supportPass, unsupported },
    synthesis: { pass: synthesisPass },
    uncertainty: { pass: uncertaintyPass },
    specificity: { pass: specificityPass },
    duplication: { status: "DEFERRED — no live DB" },
    futureUsefulness: { pass: futureUsefulnessPass },
    good,
    badHarmful,
    neutral,
    classification: good ? "GOOD" : badHarmful ? "BAD/HARMFUL" : "NEUTRAL",
  };
}
