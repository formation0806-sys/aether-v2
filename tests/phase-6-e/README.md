# PHASE 6-E — CONTROLLED REFLECTION MEASUREMENT

**EXPERIMENTAL ARTIFACTS ONLY — DO NOT USE IN PRODUCTION.**

This directory contains the isolated Phase 6-E experiment harness.
It measures, WITHOUT modifying production behavior:

1. **Experiment A — Model A/B**: `qwen2.5:3b` (production) vs `qwen3:4b`
2. **Experiment B — Prompt A/B**: `P0` (production prompt) vs `P1`/`P2`/`P3`
3. **Experiment G — Grouping**: type-keyed groups vs combined evidence
4. **Eligibility probe**: read-only Supabase gate-throughput measurement

## Files

| File | Purpose |
|---|---|
| `prompts.mjs` | P0 is an EXACT copy of the production `REFLECTION_SYSTEM_PROMPT`; P1–P3 are experiment-only variants |
| `fixtures.mjs` | Fixed input fixtures (scenarios A/B/C) with grouped + combined shapes |
| `sanitize.mjs` | Copy of production `sanitizeReflection` |
| `rubric.mjs` | Deterministic 7-criterion quality rubric (criterion 6 = DEFERRED) |
| `ollama.mjs` | Direct Ollama `/api/chat` caller (production request shape) |
| `run.mjs` | Main runner — writes `results.json` |
| `eligibility.mjs` | Read-only DB probe — writes `eligibility.json` |

## Run

```powershell
# model A/B + prompt A/B + grouping, 5 runs each (default)
node tests/phase-6-e/run.mjs --experiments A,B,G --runs 5

# subsets
node tests/phase-6-e/run.mjs --experiments A --runs 5
node tests/phase-6-e/run.mjs --experiments B --runs 5
node tests/phase-6-e/run.mjs --experiments G --runs 5

# eligibility probe
node tests/phase-6-e/eligibility.mjs
```

## Safety

- No production file is imported or modified.
- No database writes. `eligibility.mjs` issues a single read-only `limit=1` SELECT.
- No model/prompt/config/threshold in production is changed.
- Raw model outputs are stored in `results.json` for human audit.
