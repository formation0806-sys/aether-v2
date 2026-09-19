/**
 * AETHER — Approved M2-D R1 retrieval-query gate (ACT).
 *
 * Precision-gated R1 declarative rewrite for identity-attribute questions.
 * Scope is STRICTLY the retrieval-embedding input inside
 * `lib/memory/retrieve.ts`. Every other consumer receives the original
 * message byte-for-byte.
 *
 * Measured basis (docs/M2R_RETRIEVAL_DIAGNOSTIC.md §17, scripts/m2d-ab.mjs):
 *   R0 embed("What is my name?")                -> cosine 0.5254 (< 0.65, 0 rows)
 *   R1 embed("The user asks: What is my name?") -> cosine 0.6589 (>= 0.65, retrieved)
 *   Ungated R1 false positive: "What is my dog's name?" -> 0.6552 (>= 0.65)
 *
 * The gate below admits ONLY self-identity questions and structurally excludes
 * the measured non-user-possessor false-positive class. Pure and deterministic:
 * no I/O, no model calls, no dependencies.
 *
 * THRESHOLD / MODEL / SCHEMA / SCORING ARE ALL UNTOUCHED — this module only
 * decides WHICH TEXT is embedded at retrieval time.
 */

/** Exact, measured R1 prefix. Do not change (spelling, case, or spacing). */
export const R1_PREFIX = "The user asks: ";

/** Approved self-identity attributes (approved plan §5, scope rule 1). */
const IDENTITY_ATTRIBUTES: readonly string[] = [
  "name",
  "city",
  "age",
  "birthday",
  "date of birth",
  "location",
  "hometown",
  "address",
  "email",
  "phone",
  "phone number",
  "occupation",
  "job",
  "work",
  "school",
  "college",
  "favorite color",
  "favourite color",
  "favorite food",
  "favourite food",
  "favorite movie",
  "favourite movie",
  "favorite music",
  "favourite music",
  "favorite song",
  "favourite song",
  "favorite hobby",
  "favourite hobby",
  "favorite sport",
  "favourite sport",
  "favorite game",
  "favourite game",
];

/**
 * Longest-first alternation so multi-word phrases ("date of birth",
 * "favorite color") are preferred by the regex engine.
 */
const ATTRIBUTE_ALTERNATION = IDENTITY_ATTRIBUTES
  .slice()
  .sort((a, b) => b.length - a.length)
  .map((a) => a.replace(/ /g, "\\s+"))
  .join("|");

/** Self-possessed identity attribute: "my <attribute>". */
const IDENTITY_ATTRIBUTE_RE = new RegExp(
  `\\bmy (?:${ATTRIBUTE_ALTERNATION})\\b`
);

/** Question words eligible at the START of the query (approved wh-list). */
const WH_START_RE = /^(what|which|who|whose|whom)\b/;

/**
 * Approved auxiliary / inversion patterns (longest-first). "do you remember"
 * must precede "do you" so the engine consumes the fuller phrase first.
 */
const AUXILIARY_RE =
  /\b(do you remember|can you|could you|would you|did you|did i|do i|am i|is my|are my|was my|were my|have you|do you)\b/;

/** Approved imperative retrieval phrasings. */
const IMPERATIVE_RE = /\b(tell me|say my|remind me)\b/;

/** Approved exact identity-pronoun question. */
const WHO_AM_I_RE = /\bwho am i\b/;

/** "What name do you remember for me?" — no explicit "my name" token. */
const WHAT_NAME_DO_YOU_REMEMBER_RE = /\bwhat name do you remember\b/;

/** Memory-oriented self phrasings that still carry "my name". */
const MEMORY_PHRASING_MY_NAME_RE =
  /\b(do you remember|do you know|what did i tell you|what do you remember|do you have)[^.!?\n]*\bmy name\b/;

/** Explicitly approved location opt-ins. */
const EXPLICIT_LOCATION_RE = /\bwhere do i (live|stay)\b/;

/** Explicitly approved preference recall: "did i say/... i ... like/love/prefer". */
const PREFERENCE_RECALL_RE =
  /\bdid i (say|tell you|mention)\b[^.!?\n]*\b(i|that i)\b[^.!?\n]*\b(like|love|prefer)\b/;

/**
 * Exclusion kill-lock: non-user possessors such as "my dog's name",
 * "my car's name", "my friend's name". General (any word(s) before the "'s"),
 * not dog-specific.
 */
const NON_USER_POSSESSOR_RE = new RegExp(
  `\\bmy (?:[a-z]+\\s+){0,3}[a-z]+['\u2019]s (?:${ATTRIBUTE_ALTERNATION})\\b`
);

/** "named <X>" without a self-possessed attribute. */
const NAMED_ENTITY_RE = /\bnamed\b/;

/** "anyone"/"someone" forms are never identity-attribute questions. */
const ANYONE_SOMEONE_RE = /\b(anyone|someone)\b/;

/** "what is a name" / "what's a name". */
const WHAT_IS_A_NAME_RE = /\bwhat(?:'s| is) a\s+name\b/;

/**
 * Detection-only normalization: contracted "'s" becomes " is " so that
 * "what's my name" is analyzed as "what is my name". The ORIGINAL string is
 * never modified by this function or by `resolveRetrievalQuery`.
 */
function normalizeForDetection(text: string): string {
  return text.toLowerCase().replace(/'s/g, " is ");
}

function isInterrogative(norm: string): boolean {
  return (
    WH_START_RE.test(norm) ||
    AUXILIARY_RE.test(norm) ||
    IMPERATIVE_RE.test(norm) ||
    norm.endsWith("?")
  );
}

function hasIdentityScope(norm: string): boolean {
  return (
    IDENTITY_ATTRIBUTE_RE.test(norm) ||
    WHO_AM_I_RE.test(norm) ||
    WHAT_NAME_DO_YOU_REMEMBER_RE.test(norm) ||
    MEMORY_PHRASING_MY_NAME_RE.test(norm) ||
    EXPLICIT_LOCATION_RE.test(norm) ||
    PREFERENCE_RECALL_RE.test(norm)
  );
}

function hasExclusion(origLower: string, norm: string): boolean {
  if (NON_USER_POSSESSOR_RE.test(origLower)) return true;
  if (WHAT_IS_A_NAME_RE.test(norm)) return true;
  // "named <X>" or "anyone"/"someone" only when no self-possessed attribute
  // is present (belt-and-braces: the scope test already excludes most of these).
  if (NAMED_ENTITY_RE.test(origLower) && !IDENTITY_ATTRIBUTE_RE.test(norm)) {
    return true;
  }
  if (ANYONE_SOMEONE_RE.test(origLower)) return true;
  return false;
}

/**
 * True ONLY for interrogative, self-identity-attribute retrieval questions
 * that survived the exclusion kill-lock. All other inputs return false.
 */
export function isIdentityRetrievalQuery(message: string): boolean {
  if (typeof message !== "string") return false;

  const trimmed = message.trim();
  if (trimmed.length < 5 || trimmed.length > 120) return false;

  const origLower = trimmed.toLowerCase();
  const norm = normalizeForDetection(trimmed);

  if (!isInterrogative(norm)) return false;
  if (!hasIdentityScope(norm)) return false;
  if (hasExclusion(origLower, norm)) return false;

  return true;
}

/**
 * Approved R1 contract:
 *   - gate miss  -> returns `message` byte-for-byte;
 *   - gate match -> returns `R1_PREFIX + message` (original text preserved
 *     verbatim inside the rewritten embedding input).
 */
export function resolveRetrievalQuery(message: string): string {
  if (!isIdentityRetrievalQuery(message)) return message;
  return R1_PREFIX + message;
}