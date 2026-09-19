# Phase 6-AO-V16 — Verifier Forensic Audit Report

**Status:** `BLOCKED` (Ollama unreachable)
**Mode:** Measurement only. Zero-write to production. **DB_WRITES: 0.**
**Recorded:** 2026-08-31 · harness `tests/phase-6-ao/v16-verifier-forensic-audit.test.ts`
**Result:** `tests/phase-6-ao/results/v16-verifier-forensic-audit.json`

## 1. Scientific question

Does `SYS_V5` (`qwen2.5:3b`, hash-pinned `b999aa8f...93e2d`) consistently reject pair-011 and pair-034 (both SAME-labeled, V14 similarity >= 0.85) due to:
- a verifier bug / prompt ambiguity (OUTCOME_A),
- expected strictness consistent with the system prompt (OUTCOME_B),
- a multi-candidate non-clean pattern trigger rather than pair-level verdict (OUTCOME_C),
- or a mix of the above (OUTCOME_D)?

## 2. V16 test harness status

The V16 test file was created and all 10 structural assertions pass:
- Dataset frozen-SHA check
- Contract extraction + SYS_V5 hash pin
- Single-pair verifier audit (20 runs per pair, raw output capture)
- System-prompt compliance classifier
- Multi-candidate pool simulation (10 runs per pair)
- Prompt edge-case testing (3 variants x 2 pairs x 5 runs)
- Outcome classification (A/B/C/D)
- Results persistence
- Zero-write boundary assertion

**Execution was blocked at preflight:** Ollama at `127.0.0.1:11434` was unreachable.

To execute V16 live, run:
```powershell
npx vitest run tests/phase-6-ao/v16-verifier-forensic-audit.test.ts
```

## 3. V16 audit methodology (pending live execution)

### Step 1: Contract extraction
- Extract `IDENTITY_VERIFIER_MODEL`, system prompt, options, and timeout from `lib/memory/identity.ts`
- Verify hash matches `b999aa8fa91d272251123082ab437a5f748585b4fc994cf2f6378c9c53993e2d`

### Step 2: Single-pair verifier audit (Q1, Q2)
For pair-011 and pair-034:
- Run the verifier 20 times each (temperature=0)
- Capture: `decision`, `rawOutput`, `parsedReason`, `modelJsonCandidate`, `transportFailure`
- Record verdict distribution, unique reasons, and determinism (agreement >= 18 = HIGH)

### Step 3: System-prompt compliance check (Q3)
Classify each unique reason against the SYS_V5 prompt rules:
- `ENTITY_MISMATCH` → "different concrete entities" rule (GitHub vs GitLab)
- `SCOPE_MISMATCH` → "different scope" rule
- `PREFERENCE_VS_USAGE` → "preference vs current usage when they assert conflicting values"
- `SEMANTIC_PARAPHRASE` → "same underlying user fact"
- `AMBIGUOUS` / `UNCLASSIFIABLE`

Record whether the verifier's behavior is internally consistent with its own prompt.

### Step 4: Multi-candidate pool simulation (Q4)
For each pair:
- Construct a synthetic pool: target memory + 1-2 same-factKey memories + 1 decoy
- Run the production verifier logic (verify all candidates, require all-SAME clean pool)
- Determine rejection cause: `pair-level` (target itself is DIFFERENT) vs `pool-level` (another candidate is DIFFERENT)

### Step 5: Prompt edge-case testing (Q5)
Test 3 prompt variants against both pairs (5 runs each):

| Variant | Description |
|---------|-------------|
| VARIANT_A | Remove "different concrete entities" rule |
| VARIANT_B | Reword "preference vs usage" to be less strict |
| VARIANT_C | Add explicit exception for "same tool category" |

Record whether any variant flips the modal verdict to SAME.

## 4. V14 baseline data (already measured)

| Pair | factKey | V14 Similarity | Eligible | Verdict |
|------|---------|----------------|----------|---------|
| pair-011 | technology-preference | 0.865164 | YES | DIFFERENT |
| pair-034 | tools | 0.865992 | YES | DIFFERENT |

Both pairs:
- Were eligible under V14 (similarity >= 0.85)
- Received DIFFERENT verdict from SYS_V5
- Are identical in V13 and V14 (prefix did not change outcomes)
- Represent 2 of the 22 SAME false negatives preventing TP=19

## 5. Decision rules (from V15/V16 plans)

1. **OUTCOME_A** (verifier bug / prompt ambiguity): Verifier gives inconsistent reasons or contradicts its own prompt → propose prompt refinement (subject to separate safety review)
2. **OUTCOME_B** (expected strictness): Verifier consistently rejects with prompt-backed reasons → document as verifier-design-intrinsic limitation
3. **OUTCOME_C** (non-clean pattern trigger): Rejection caused by candidate-pool design → recommend separate candidate-pool design review
4. **OUTCOME_D** (mixed): Combined milestone addressing both prompt and pool design

## 6. Next steps

1. Start Ollama locally: ensure `qwen2.5:3b` is installed (`Invoke-RestMethod http://127.0.0.1:11434/api/tags`)
2. Execute V16 test: `npx vitest run tests/phase-6-ao/v16-verifier-forensic-audit.test.ts`
3. Review generated `v16-verifier-forensic-audit.json` for outcome classification
4. If OUTCOME_A or OUTCOME_D: schedule prompt refinement milestone with safety review
5. If OUTCOME_C: schedule candidate-pool design review milestone
6. If OUTCOME_B: document as verifier-design-intrinsic limitation; no code change justified

## 7. Constraints preserved

- Production code untouched (`lib/memory/identity.ts` unchanged)
- Threshold frozen at 0.85
- Verifier model frozen at `qwen2.5:3b`
- Dataset frozen (SHA `5B0C84...F049`)
- No model installations, no migrations, no DB writes
- `npm run build` passes
