# PHASE 6-AO-V23 — Bench-Contract Decoy-Split Report

**Phase:** 6-AO-V23  |  **Mode:** READ-ONLY contract implementation (Option E)

## 1. Purpose

Implement the V22-recommended contract treatment: keep the frozen 22-item binary
SAME-recall corpus EXACTLY as-is, and track pair-034 in a SEPARATE safety-decoy
corpus. The frozen contract's numbers are unchanged; V20's recall-gate FAIL remains
the legitimate, reproducible result. The pair-034 contradiction (V21: CLEAR_DIFFERENT,
CASE-E, INVALID_FOR_BINARY_BENCHMARK + VALID_AS_SAFETY_DECOY) is resolved by
separation, not by altering denominator, labels, threshold, verifier, or production.

## 2. Frozen benchmark contract (unchanged)

- dataset SHA-256: 5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049
- SAME denominator: 22  (21 DIFFERENT; 43 total)
- threshold: 0.85
- verifier: SYS_V5 (hash b999aa8f…93e2d)
- TP gate: >= 19  (recall >= 83.18%, i.e. +15pp vs V11 anchor)

## 3. Recall-gate recomputation (from recorded V11/V14/V20 evidence)

- V11 anchor TP @0.85: 15  (recall 68.18%)
- Best measured TP (V14 / V20 Control B, symmetric "query: "): 0  (recall 0.00%)
- Required recall for +15pp gate: 83.18%  =>  required TP = 19
- Recall gate result: FAIL  -> V20 status = FAIL

V20's FAIL is mathematically and semantically legitimate. The decoy split does NOT
alter this number; it only separates the safety metric from recall.

## 4. pair-034 as safety decoy (independent metric)

- Recorded verifier verdicts: DIFFERENT=127, SAME=0, rate=1 (100%)
- Semantic distinctness: GitHub vs GitLab (distinct concrete entities; V3, V16 ENTITY_MISMATCH).
- Consistency: 100% DIFFERENT across V4/V5/V6/V11(20-20)/V14/V15/V16(20-20)/V17/V18/V20.
- Reported as a safety metric ONLY; it does not compensate or feed the binary recall gate.

## 5. Decoy manifest

- File: tests/phase-6-ao/decoy-corpus.json
- pair-034: role=SAFETY_DECOY, frozenLabel=SAME (unchanged), classificationRef=6-AO-V21.
- The frozen SAME label in dataset.json is NOT modified by this manifest.

## 6. Anti-gaming assessment

- No denominator/label change => the original gate meaning is preserved.
- V20's FAIL is not retroactively flipped; comparability with V11-V20 is fully preserved.
- Option E avoids post-hoc metric optimization (unlike silent B/C/D denominator/label changes).

## 7. Zero-write / integrity

- DB_WRITES = 0
- PERSISTENCE_CONTACT = false
- MODEL_RUNTIME_CONTACT = false
- NETWORK_CONTACT = false
- PRODUCTION_CHANGED = false
- DATASET_CHANGED = false
- HISTORICAL_ARTIFACTS_CHANGED = false
- dataset SHA before === after: true
- identity.ts SHA before === after: true
- protected (non-v23) results files byte-identical: 51 checked

## 8. Files created

- tests/phase-6-ao/decoy-corpus.json
- tests/phase-6-ao/v23-bench-contract.test.ts
- tests/phase-6-ao/results/v23-bench-contract-report.md

## 9. Verification commands

```
npx vitest run tests/phase-6-ao/v23-bench-contract.test.ts   # expect: PASS
npx tsc --noEmit --incremental false --pretty false            # expect: no NEW errors
npm run build                                              # expect: success
git status --short                                         # expect: only the 3 V23 files
```

## 10. Out of scope (must NOT be done by V23)

- Any dataset.json mutation (B/C/D), threshold/denominator/verifier change, or production edit.
- Auto-starting a dataset-revision milestone. Any real mutation requires separate approval + re-baselining.