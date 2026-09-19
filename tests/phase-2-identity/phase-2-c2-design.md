# Phase 2-C2 Design Plan — Cross-Title Conflict Detection (Frozen-API Safe)

Status: DESIGN ONLY. No production code implemented. Pending approval before implementation.

## 0. Root cause of the aborted implementation

The rejected C2 wired `detectCrossTitleConflicts()` to call `verifyIdentity()`
(the SAME LLM verifier used by `resolveMemoryIdentity`). Because the existing
identity test suite mocks that verifier with a fixed/queue-based set of scripted
responses, every extra `verifyIdentity()` call inside the detector consumed a
response that the production resolver sequence later needed. This starved the
resolver's own verifier calls and produced 7 regressions.

**Conclusion:** conflict detection must NOT share, call, or observe the
production verifier's responses in any way. It must be a fully independent,
isolated observation path.

---

## 1. Hard constraints (from task)

1. Detection must NOT call `verifyIdentity()` inside the `resolveMemoryIdentity()` verifier sequence.
2. Existing identity-resolution behavior and verifier call ordering must remain unchanged.
3. Conflict detection must remain flag-only and non-blocking.
4. No prompts, thresholds, frozen files, schemas, migrations, or retrieval behavior may be changed.
5. No production writes during validation.
6. The design must specify exactly where detection observes candidates WITHOUT consuming the existing verifier's responses.
7. Include zero-write tests proving existing identity tests stay deterministic.
8. Include S1–S6 conflict scenarios.
9. Define potential contradiction vs. legitimate coexistence.
10. No production code written yet.

---

## 2. Architectural principle: isolated, injected, network-free observation

The detector becomes a **pure, deterministic observer** over the candidate
snapshot that `resolveMemoryIdentity` has already retrieved. It never performs
any fetch, never calls `verifyIdentity`, and never touches the verifier's
mocked/queued responses.

Three seams are introduced as **optional, defaulted dependencies** so the public
behavior of `resolveMemoryIdentity` is byte-for-byte preserved for production
callers (they pass nothing):

- `conflictClassifier?: (a, b) => boolean` — default = `lexicalContradictionHeuristic`.
- `flagConflict?: (userId, aId, bId) => void` — default = existing `flagContradiction` (already fail-safe, fire-and-forget).
- The verifier (`verifyIdentity`) remains exactly as-is and is never referenced by the detector.

Because the default classifier is a pure function over already-present fields
(title, content, memory_type, similarity, status), it requires **zero network
calls** and therefore consumes **zero** verifier responses. Tests inject stubs
to make detection fully deterministic and to assert isolation.

---

## 3. Observation point (answers constraint #6)

Inside `resolveMemoryIdentity`, the candidate set `rows` is materialized by:

1. `embed(content)`
2. `matchMemoriesV2(...)`  ← already fetches candidates
3. `rows = rows.filter(r => r.status !== "merged")`  ← Phase 2-C1 guard

**Detection is invoked immediately after step 3 and BEFORE the `for (const cand of ordered)` verifier loop.**

```
rows = rows.filter((r) => r.status !== "merged");

// C2 (frozen-API safe): observe the already-retrieved candidate snapshot.
// Uses an INJECTED, network-free classifier. Never calls verifyIdentity,
// never consumes the resolver's verifier responses.
if (rows.length > 1) {
  void detectCrossTitleConflicts(rows, userId, deps);
}

// ... existing verifier loop (UNCHANGED) ...
```

Why this location satisfies constraint #6:
- `rows` is already fetched; detection reads a local array — no new retrieval.
- The classifier is injected/defaulted and never calls `verifyIdentity`, so the
  resolver's verifier queue is never touched.
- The verifier loop that follows is completely unaffected in ordering, count, or inputs.

---

## 4. `detectCrossTitleConflicts` — new contract

Signature (non-breaking; deps optional):

```ts
export async function detectCrossTitleConflicts(
  candidates: IdentityCandidate[],
  userId: string,
  deps: {
    conflictClassifier?: (a: IdentityCandidate, b: IdentityCandidate) => boolean;
    flagConflict?: (userId: string, aId: string, bId: string) => void;
  } = {}
): Promise<void>
```

Behavior:
- Filter `strong = candidates` where `status === "active"` AND `similarity >= IDENTITY_CANDIDATE_MIN_SIMILARITY` (reuses the EXISTING constant — no new threshold).
- For each unordered pair `(a, b)` with `a.title !== b.title`:
  - call `deps.conflictClassifier(a, b)` (default = `lexicalContradictionHeuristic`).
  - if `true`, `void deps.flagConflict(userId, a.id, b.id)` (default = `flagContradiction`, already fire-and-forget + fail-safe).
- All exceptions caught and logged; never thrown; never returned; never blocks the resolver.

This is the ONLY change inside `identity.ts`, and it replaces the rejected
implementation that called `verifyIdentity`.

---

## 5. Default classifier — `lexicalContradictionHeuristic` (answers #4, #9)

Pure function, no LLM, no fetch. Operates on `title`, `content`, `memory_type`,
`similarity`. Combines two gates:

### Gate A — scope/attribute overlap (precondition)
A pair is even *eligible* only if both memories plausibly describe the **same
real-world attribute** for the same subject. Determined by:
- `memory_type` equality OR a small static "comparable type" map
  (e.g. `identity`↔`identity`, `preference`↔`preference`); cross-type pairs
  (e.g. `identity` vs `project`) are ineligible → legitimate coexistence.
- Both titles/contents share a **subject token** (person, place, entity) after
  stop-word removal. No shared subject → ineligible.

### Gate B — opposition signal (the contradiction test)
Within an eligible pair, flag `true` only if a deterministic opposition signal
is present between the two contents:
- **Negation/antonym pair**: one contains a negation marker (`not`, `never`,
  `no longer`, `don't`, `doesn't`) while the other asserts the positive.
- **Temporal shift**: one contains a past marker (`used to`, `previously`,
  `formerly`, `was`, `used to live`) and the other a present marker
  (`currently`, `now`, `live`, `am`, `work at`) on the same subject.
- **Explicit value divergence**: structured values differ where structure is
  detectable (e.g. city names, numeric quantities, named entities extracted by
  a tiny static extractor — no model, no prompt).
- **Antonym lexicon**: a static, frozen list (e.g. `like/dislike`,
  `love/hate`, `always/never`) — no LLM.

If none of B's signals fire → `false` (legitimate coexistence).

This heuristic is intentionally conservative and offline. It never needs the
verifier, so it never consumes verifier responses. It can later be upgraded
(behind the injected `conflictClassifier` seam) without touching the resolver.

---

## 6. Potential contradiction vs. legitimate coexistence (answers #9)

**Potential contradiction** — all true:
- different `title` (else it is Phase 2-B supersession, not cross-title),
- both `status === "active"`,
- both `similarity >= IDENTITY_CANDIDATE_MIN_SIMILARITY` (existing floor),
- same comparable `memory_type` / shared subject (Gate A),
- an opposition signal between their values (Gate B: negation, temporal shift,
  explicit value divergence, or antonym).

**Legitimate coexistence** — any of:
- same `title` (handled by Phase 2-B, excluded here),
- different `memory_type` with no shared attribute,
- shared subject but no opposition signal (merely related/complementary facts,
  e.g. "I like tea" vs "I prefer running"),
- one memory already `merged` (excluded by Phase 2-C1 guard),
- similarity below the existing floor.

Detection only *flags*; it never merges, never un-merged, never alters the
resolution decision.

---

## 7. Zero-write determinism tests (answers #5, #7)

File: `tests/phase-2-identity/cross-title-conflict.test.ts` (recreated, but
the detector logic is pure and the verifier is never called by it).

Test groups:

**D1 — Isolation invariant (core regression guard).**
Inject `conflictClassifier` and `flagConflict` as counting stubs. Run
`resolveMemoryIdentity` with the EXISTING scripted verifier fixtures. Assert:
- the resolver's returned decision is identical to the pre-C2 baseline,
- the number of `verifyIdentity` calls equals the pre-C2 count exactly,
- the detector's classifier/flag stubs were invoked the expected number of
  times **independently** of the verifier queue.

**D2 — Detector unit (pure, no network).**
Call `detectCrossTitleConflicts(rows, userId, { conflictClassifier: real, flagConflict: spy })`
directly with hand-built `IdentityCandidate[]`. No `embed`, no `matchMemoriesV2`,
no verifier. Assert flag calls match the heuristic's verdicts.

**D3 — Baseline parity.**
Re-run the existing 13 identity tests (artifacts, decision-probe,
pipeline-integration, supersession-retrieval) unchanged and assert they still
pass with 0 regressions. This is the hard requirement from the reset verification.

**D4 — No-write validation.**
Assert `flagConflict` is never the real `flagContradiction` during tests (it is
the injected spy), so no `memory_edges` row is written. Detection is therefore
write-free under validation.

---

## 8. S1–S6 conflict scenarios (answers #8)

- **S1 — Opposite value, same attribute (CONTRADICTION).**
  A: "I live in London" (identity). B: "I live in Paris" (identity).
  Shared subject `I/live`, divergence in city value → flagged.

- **S2 — Same title, different content (NOT cross-title).**
  A: "My name is Sam" v1. B: "My name is Sam" v2.
  `a.title === b.title` → skipped; handled by Phase 2-B supersession. No flag.

- **S3 — Related but non-opposing facts (COEXISTENCE).**
  A: "I like tea" (preference). B: "I prefer running" (preference).
  Shared subject? weak; no opposition signal → not flagged.

- **S4 — Different memory_type, overlapping similarity (COEXISTENCE).**
  A: "I live in London" (identity, sim 0.91). B: "London trip project" (project, sim 0.88).
  Cross-type, no comparable attribute pair → ineligible → not flagged.

- **S5 — Temporal shift (CONTRADICTION).**
  A: "I used to work at Acme" (identity). B: "I currently work at Globex" (identity).
  Past marker vs present marker, same subject `work` → flagged.

- **S6 — Merged memory present (EXCLUDED).**
  A: "I live in London" (active). B: "I live in London" (status `merged`).
  Phase 2-C1 guard removes B before detection → not flagged; never re-corroborated.

---

## 9. What is unchanged (explicit non-goals)

- `verifyIdentity` prompt, model, temperature, and call sites: unchanged.
- Verifier call ordering and count inside `resolveMemoryIdentity`: unchanged.
- `IDENTITY_CANDIDATE_MIN_SIMILARITY`, `IDENTITY_CANDIDATE_COUNT`: unchanged.
- `matchMemoriesV2` RPC, embeddings, retrieval, migrations: unchanged.
- Phase 2-B supersession and Phase 2-C1 merged-status filter: unchanged.
- `flagContradiction` (existing separate module): unchanged in contract; only
  called by the detector via the injected seam.

---

## 10. Implementation checklist (post-approval only — NOT executed now)

1. Add `lexicalContradictionHeuristic` (pure) in `lib/memory/identity.ts`.
2. Change `detectCrossTitleConflicts` to accept `deps` and use the injected
   classifier + flag function instead of `verifyIdentity`.
3. Move/keep the detection call after the merged filter, before the verifier loop.
4. Keep `flagContradiction` in `lib/memory/conflict.ts` as-is.
5. Add `tests/phase-2-identity/cross-title-conflict.test.ts` (D1–D4).
6. Run `vitest run tests/phase-2-identity` → 0 regressions; run `tsc --noEmit`.

**Production code status: NONE WRITTEN.**
