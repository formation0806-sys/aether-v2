# Phase 6-AO-V11 — Band Probe Report (SYS_V5 × 0.80)

**Status:** `COMPLETE` → **`V11_STATUS = FAIL` (pre-declared gate)**
**Mode:** Measurement only. Zero-write to production. **DB_WRITES: 0.**
**Recorded:** 2026-08-30 · harness `tests/phase-6-ao/v11-band-probe.test.ts` · result `tests/phase-6-ao/results/v11-band-probe.json`

## 1. Scientific question

Does the adopted production verifier prompt (SYS_V5, hash `b999aa8f…93e2d`) at an
experimental candidate floor of **0.80** satisfy the original Phase 6-AO promotion
gate — recall gain ≥ +15pp (frozen denominator TP/22), FCR ≤ 5%, repeatability
≥ 18/20 — versus the production floor 0.85? This was the single unmeasured cell
in the threshold decision matrix (SYS_V5 had only ever been measured at 0.85).

## 2. Gates (pre-declared; fixed-corpus recall ONLY)

| Gate | Value | Result |
|---|---|---|
| G-V11-RECALL | recall gain **+13.64pp** (< +15pp required) | **FAIL** |
| G-V11-SAFETY | FCR080 = **0** (≤ 5%) | PASS |
| G-V11-REPEATABILITY | 10/10 band cells modal **20/20** (≥ 18/20) | PASS |
| **OVERALL** | | **FAIL** |

**V11 = FAIL. Production threshold remains 0.85. No adoption.**

## 3. Full-corpus metrics (frozen dataset 43 pairs = 22 SAME / 21 DIFFERENT, SHA `5B0C84…F049`)

| Metric | runA @ 0.85 (production) | runB @ 0.80 (experimental) |
|---|---|---|
| candidates | 20 | 30 |
| TP / FN | 15 / 1 | 18 / 2 |
| FP / TN | 0 / 4 | 0 / 10 |
| **fixed-corpus SAME recall (TP/22)** | **0.6818 (68.18%)** | **0.8182 (81.82%)** |
| conditional recall (continuity only) | 0.9375 | 0.9000 |
| precision / FCR | 1.0000 / 0 | 1.0000 / 0 |

**Recall gain = (18 − 15)/22 × 100 = +13.64pp — below the +15pp gate.**
runA exactly reproduces the immutable V5/V6 anchor (15/1/0/4, candidates 20)
(`anchorReproduced: true`) and both full runs produced identical confusion
matrices (temp-0 determinism; `sharedVerdictMismatch: 0` across arms).

## 4. Critical-band evidence (the decision cell itself)

10 band cells (eligible @0.80, not @0.85) — all soaked **20× sequential, temp 0**:

| Pair | Label | Similarity | Soak modal (20 runs) | Effect on gate |
|---|---|---|---|---|
| pair-039 | SAME | 0.848160 | SAME 20/20 | +1 TP |
| pair-013 | SAME | 0.845069 | SAME 20/20 | +1 TP |
| pair-034 | SAME | 0.840741 | **DIFFERENT 20/20** | +1 FN (the decoy) |
| pair-007 | SAME | 0.804500 | SAME 20/20 | +1 TP |
| pair-038/026/010/004/002/024 | DIFFERENT | 0.8338–0.8030 | DIFFERENT 20/20 ×6 | **0 FP** |

**Decisive finding:** of the 4 band-SAME pairs, SYS_V5 recovers 3 and rejects
exactly one — **pair-034, the known frozen semantic decoy** (DIFFERENT 20/20 here;
DIFFERENT 50/50 under *both* arms in V6's 50× soak). With pair-034 immovable,
max achievable TP080 = 18 → **max achievable gain at 0.80 = +13.64pp — the +15pp
gate is arithmetically unreachable** on the frozen dataset with the current
production prompt. Zero false corroboration occurred anywhere (250 verifier
calls per run; UNCERTAIN = 0; transport retries = 0).

## 5. Execution provenance

- Ollama `127.0.0.1:11434` reachable; models `nomic-embed-text:latest`, `qwen2.5:3b` present.
- Contract extracted at runtime from `lib/memory/identity.ts` (AK.1): model `qwen2.5:3b`,
  options `{0, 256, 0.9}`, timeout 30000 ms, prompt SHA-256 hard-pinned to
  `b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d` (asserted in-harness).
- Production threshold literal `0.85` asserted present in source before the run.
- Network destinations: `127.0.0.1:11434` only (`/api/tags`, `/api/embed`, `/api/chat`).
- Per full run: 86 embed calls + 250 verifier calls (20 runA + 30 runB + 200 soak), sequential.

## 6. Run history & transparency

| Run | Outcome |
|---|---|
| Run 1 | All measurements completed; 5/6 tests passed. Two harness-metadata defects disclosed: (a) the self-referential no-import assertion matched its own source text (`expected true to be false`); (b) `state.status` was never set to COMPLETE after preflight (artifact metadata said PENDING). **Metrics were complete and valid.** |
| Run 2 | Both defects fixed (runtime-assembled literals; status assignment). **6/6 tests PASS. Canonical run. Metrics identical to run 1.** |

## 7. Integrity ledger

- **DB_WRITES = 0** · Supabase contact: none · migrations untouched (0017/0018 intact)
- `lib/memory/identity.ts` byte-identical pre/post (`git hash-object 59e20dbe…` unchanged)
- Dataset SHA-256 unchanged (`5B0C84…F049`); no pair relabeled
- All historical AO artifacts byte-identical pre/post (results ledger diff: only the new V11 slot added)
- Git status grew exactly by the two new V11 files; nothing else modified; **no commit/push/deploy**
- TypeScript: 9 pre-existing baseline errors unchanged (`v4-decision-boundary` ×7, `verifier-contract-v2` ×2), **NEW_ERRORS = 0**
- `npm run build`: **PASS**

## 8. Conclusion

> **V11 = FAIL** under the pre-declared promotion gate: SYS_V5 × 0.80 gains
> +13.64pp fixed-corpus recall (identical to the +13.63pp historically achieved
> by 0.80 × SYS_A), with perfect safety (FCR 0) and perfect stability (20/20
> everywhere), but the recall-gate threshold of +15pp is not met — and is
> arithmetically unreachable while pair-034 remains a frozen SAME-labeled pair
> that the verifier deterministically rejects.

**The threshold question is CLOSED — 0.80 failed the pre-declared gate.**
Production remains `IDENTITY_CANDIDATE_MIN_SIMILARITY = 0.85`, SYS_V5 unchanged.
No threshold-adoption milestone is warranted on this evidence. Residual recall
lives in the embedding layer (pair-005/041, sim ≈ 0.764/0.769) and in the
dataset/verifier disagreement on the pair-034 decoy and pair-011 — both out of
scope for threshold tuning.