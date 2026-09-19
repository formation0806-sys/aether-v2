# Phase 6-AO-V13 — Embedding Model Evaluation Report

**Status:** `BLOCKED`
**Mode:** Measurement only. Zero-write to production. **DB_WRITES: 0.**
**Recorded:** 2026-08-30 · harness `tests/phase-6-ao/v13-embedding-model-evaluation.test.ts`
result `tests/phase-6-ao/results/v13-embedding-model-evaluation.json`

## 1. Scientific question

Does an alternative locally-available embedding model improve SAME-pair retrieval at
the FIXED production identity boundary 0.85 (SYS_V5 verifier) while preserving the
verifier safety contract? This is the next legitimate cell after V11/V12 closed the
threshold and confirmed the embedding-layer limitation (H1). The ONLY independent
variable is the embedding model; everything else (dataset, SYS_V5, threshold 0.85,
candidate count 8, verifier options) is frozen.

## 2. Outcome — `V13 = BLOCKED`

The harness ran and reached a clean BLOCK at the preflight stage:

```
STATUS = BLOCKED
REASON = OLLAMA_UNREACHABLE:fetch failed
```

`GET /api/tags` to `127.0.0.1:11434` failed (connection refused / fetch failed). Ollama
was reachable during the V11 canonical run earlier the same day (18:05Z) but is not
listening in this environment now. Because the harness cannot reach Ollama, it cannot
confirm the live installed-model list and cannot embed/verify — so the experiment
cannot proceed. The harness recorded this with evidence rather than fabricating any
measurement (per the anti-hallucination rule and milestone §22 "Ollama unreachable").

**Standing secondary constraint (from the read-only audit, not newly measured):** the
only embedding model installed locally is `nomic-embed-text:latest` (V11's
`ollamaModelsSeen` at 18:05Z listed exactly that plus three chat models
`qwen2.5-coder:7b`, `qwen2.5:3b`, `qwen3:4b`). So even if Ollama were reachable, there
is **no alternative embedding model installed** → the candidate-selection protocol
would independently resolve to `CANDIDATE_NOT_SPECIFIED` / no-suitable-model. Both
blockers co-exist.

## 3. What the harness would have done (design, for when unblocked)

1. Live `GET /api/tags` + embedding-capability probe; resolve `V13_CANDIDATE_MODEL`
   (explicit env; no default). BLOCK if unset / not installed / equals baseline /
   embedding fails.
2. Pin SYS_V5 prompt hash `b999aa8f…93e2d`; assert production threshold literal 0.85.
3. Baseline anchor: re-embed all 43 pairs with `nomic-embed-text:latest`; assert
   pair-005 ≈ 0.764026 and pair-041 ≈ 0.768679 (reproduces V11/V12). BLOCK on drift.
4. Candidate embed; compute cosine; eligibility @0.85; run SYS_V5 verifier on eligible
   pairs (zero-write, local only).
5. Metrics: TP/TN/FP/FN, fixed recall = TP/22, FCR, candidate count, SAME recovered/
   missed, DIFFERENT incorrectly admitted, pair-005/041 candidate similarity.
6. Repeatability soak of newly-promoted band cells ×20 (≥18/20).
7. Pre-declared gates: RECALL GAIN ≥ +15pp, FCR ≤ 5%, REPEATABILITY ≥ 18/20.

## 4. Gates

Not evaluated — experiment did not reach the measurement stage (BLOCKED pre-flight).

| Gate | Value | Result |
|---|---|---|
| G-V13-RECALL | NOT MEASURED | — |
| G-V13-SAFETY | NOT MEASURED | — |
| G-V13-REPEATABILITY | NOT MEASURED | — |
| **OVERALL** | | **BLOCKED** |

## 5. Execution provenance

- Ollama `127.0.0.1:11434` — **UNREACHABLE** this run (`fetch failed`). `ollamaModelsSeen`
  is empty in the result; no model list could be captured live.
- Best-available model evidence remains V11's recorded list (2026-08-30T18:05Z): only
  `nomic-embed-text:latest` is an embedding model.
- Contract/prompt extraction and baseline anchor were SKIPPED (blocked pre-flight) — no
  fabrication of SYS_V5 hash, dimensions, or similarities.

## 6. Integrity ledger

- **DB_WRITES = 0** · Supabase contact: none · migrations `0017/0018` untouched.
- Production embedding code (`lib/ai/embeddings/embed.ts`), `lib/memory/*`, and
  `lib/repositories/memory.repository.ts` byte-identical (not imported by the harness).
- Dataset SHA-256 unchanged (`5B0C84…F049`); no pair relabeled.
- Historical AO artifacts (`v11-*`, `v12-*`) untouched — only the new V13 slot added.
- TypeScript: 9 pre-existing baseline errors (`v4-decision-boundary` ×7,
  `verifier-contract-v2` ×2), **NEW_ERRORS = 0** (V13 file compiles clean).
- Files added (additive only): `v13-embedding-model-evaluation.test.ts`,
  `results/v13-embedding-model-evaluation.json`, `results/v13-report.md`.
- No commit/push/deploy; no model install/download.

## 7. Conclusion

> **V13 = BLOCKED** (OLLAMA_UNREACHABLE; and, independently, no alternative embedding
> model installed locally). No measurement was fabricated. Production remains
> `nomic-embed-text:latest`, threshold 0.85, SYS_V5 unchanged.

**To unblock (separate, explicit approval required):**
1. Ensure Ollama is running and reachable at `127.0.0.1:11434`; AND
2. Approve installing a real embedding model (e.g., `mxbai-embed-large`, `bge-m3`,
   `all-minilm`) and set `V13_CANDIDATE_MODEL=<model>`, OR confirm an already-installed
   embedding model.

Then re-run: `npx vitest run tests/phase-6-ao/v13-embedding-model-evaluation.test.ts`
Adoption of any passing candidate is a SEPARATE milestone — V13 never changes production.
