# Phase 6-AO-V10 — Post-Adoption Observability Report

**Status:** V10_PASS
**Timestamp:** 2026-08-27T10:08:47.499Z

## Preflight

- Production prompt hash: `b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d`
- Dataset hash: `5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049`
- Threshold: `0.85`
- Candidate count: `8`
- Model: `qwen2.5:3b`
- Options: `{"temperature":0,"num_predict":256,"top_p":0.9}`
- Timeout: `30000ms`

## Gates

- G-V10-ZEROWRITE: PASS
- G-V10-PRODUCTION-PROMPT-INTEGRITY: PASS
- G-V10-THRESHOLD-INTEGRITY: PASS
- G-V10-DATASET-FROZEN: PASS
- G-V10-HISTORY-INTACT: PASS
- G-V10-LIVE-PATH: PASS
- G-V10-SAFETY: PASS
- G-V10-REPEATABILITY: PASS

## Cases

### SAME / Important

| Pair | Verdict | Target | Similarity |
|------|---------|--------|------------|
| pair-001 | corroborate | mem-pair-001-b | 0.92 |
| pair-019 | corroborate | mem-pair-019-b | 0.92 |
| pair-035 | corroborate | mem-pair-035-b | 0.92 |

### DIFFERENT / Safety

| Pair | Verdict | Reason |
|------|---------|--------|
| pair-011 | create | non-clean pattern: DIFFERENT after 1 verified candidate(s) |
| pair-034 | create | non-clean pattern: DIFFERENT after 1 verified candidate(s) |
| pair-028 | create | non-clean pattern: DIFFERENT after 1 verified candidate(s) |
| pair-031 | create | non-clean pattern: DIFFERENT after 1 verified candidate(s) |
| pair-032 | create | non-clean pattern: DIFFERENT after 1 verified candidate(s) |
| pair-042 | create | non-clean pattern: DIFFERENT after 1 verified candidate(s) |

### Retrieval-Reference

| Pair | Verdict | Reason |
|------|---------|--------|
| pair-005 | create | no semantic candidates (below 0.85 retrieval floor) |
| pair-041 | create | no semantic candidates (below 0.85 retrieval floor) |

## 20× Repeatability Distributions

| Pair | SAME | DIFFERENT | Modal | Agreement | Sequence |
|------|------|-----------|-------|-----------|----------|
| pair-001 | 20 | 0 | SAME | 20/20 | SAME x20 |
| pair-011 | 0 | 20 | DIFFERENT | 20/20 | DIFFERENT x20 |
| pair-019 | 20 | 0 | SAME | 20/20 | SAME x20 |
| pair-034 | 0 | 20 | DIFFERENT | 20/20 | DIFFERENT x20 |
| pair-035 | 20 | 0 | SAME | 20/20 | SAME x20 |

## Safety

- DB writes: `0`
- Supabase contact: `false`
- Network destinations: `127.0.0.1:11434`
- Ollama models: `nomic-embed-text:latest, qwen2.5:3b`

## Scientific Notes

- LIVE VERIFIER OBSERVATION: real production SYS_V5 path exercised with mocked persistence.
- RETRIEVAL LIMITATION: pair-005 and pair-041 are below the 0.85 verifier candidate floor and return create due to no candidates.
- DATASET ANOMALY: pair-034 remains the frozen semantic decoy and never becomes SAME.
- PERSISTENCE NOT TESTED: no Supabase writes were performed; real DB behavior remains unexercised.

## Build & Validation

- TypeScript (`npx tsc --noEmit`): PASS (no new errors in V10 test file; pre-existing errors in v4-decision-boundary.test.ts and verifier-contract-v2.test.ts are not caused by V10 changes)
- Build (`npm run build`): PASS
- V10 test suite: 22/22 passed

## Git Status

- NO commit
- NO push
- NO PR
- NO deployment
- NO tag
- Modified files: pre-existing modifications from V7/V8/V9 work (not caused by V10)
- Created files: `tests/phase-6-ao/results/v10-post-adoption-observability.json`, `tests/phase-6-ao/results/v10-report.md`
