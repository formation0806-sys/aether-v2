# Phase 6-AO-V10 — Post-Adoption Observability Report

**Status:** V10_PASS
**Timestamp:** 2026-09-13T09:40:44.176Z

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

- SAME/important: pair-001, pair-019, pair-035
- DIFFERENT/safety: pair-011, pair-034, pair-028, pair-031, pair-032, pair-042
- Retrieval-reference: pair-005, pair-041
- Repeatability: pair-001, pair-011, pair-019, pair-034, pair-035

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

**Build:** run `npm run build` separately if required by your gate.
**TypeScript:** run `npx tsc --noEmit` separately if required by your gate.
