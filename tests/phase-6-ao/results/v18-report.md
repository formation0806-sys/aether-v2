# Phase 6-AO-V18 — Verifier Policy Generalization Report

**Status:** `PENDING`
**Mode:** Measurement only. Zero-write to production. **DB_WRITES: 0.**
**Recorded:** 2026-08-31 · harness `tests/phase-6-ao/v18-verifier-policy-generalization.test.ts`
**Result:** `tests/phase-6-ao/results/v18-verifier-policy-generalization.json`

## 1. Scientific question

Does POLICY_B improve SAME-case recall across the full frozen Phase 6-AO corpus while preserving:
- FCR <= 5%
- repeatability >= 18/20 critical-band agreement
- production threshold fixed at 0.85
- frozen dataset unchanged

## 2. Population

- Total eligible pairs: 25
- SAME pairs: 20
- DIFFERENT pairs: 5

## 3. Policy comparison

| Policy | TP | FN | TN | FP | FCR | fixedRecall | recallGainPP | changed |
|--------|----|----|----|----|-----|-------------|--------------|---------|
| POLICY_A | 18 | 2 | 5 | 0 | 0 | 0.8182 | 13.64 | 0 |
| POLICY_B | 19 | 1 | 5 | 0 | 0 | 0.8636 | 18.18 | 1 |
| POLICY_C | 18 | 2 | 5 | 0 | 0 | 0.8182 | 13.64 | 0 |

## 4. POLICY_B changed cells

| Pair | Label | Baseline | POLICY_B | Direction | Improves |
|------|-------|----------|----------|-----------|----------|
| pair-011 | SAME | DIFFERENT | SAME | null | YES |

## 5. Repeatability

| Pair | Policy | Modal | Agreement | Passed |
|------|--------|-------|-----------|--------|
| pair-011 | POLICY_B | SAME | 20/20 | YES |

## 6. Critical-band analysis

Pairs in similarity range [0.80, 0.90):

| Pair | Label | Similarity | Baseline | POLICY_B Changed | Improved | Endangered |
|------|-------|------------|----------|------------------|----------|------------|
| pair-002 | DIFFERENT | 0.856616 | DIFFERENT | NO | NO | NO |
| pair-011 | SAME | 0.865164 | DIFFERENT | YES | YES | NO |
| pair-024 | DIFFERENT | 0.864874 | DIFFERENT | NO | NO | NO |
| pair-025 | SAME | 0.899457 | SAME | NO | NO | NO |
| pair-028 | DIFFERENT | 0.859088 | DIFFERENT | NO | NO | NO |
| pair-032 | DIFFERENT | 0.869871 | DIFFERENT | NO | NO | NO |
| pair-034 | SAME | 0.865992 | DIFFERENT | NO | NO | NO |
| pair-041 | SAME | 0.861730 | SAME | NO | NO | NO |
| pair-042 | DIFFERENT | 0.875855 | DIFFERENT | NO | NO | NO |

## 7. Outcome

**Classification:** `POLICY_NON_GENERALIZING`
**Reason:** POLICY_B recovered only the known target pair-011 (changedCount=1); broader corpus does not support generalization

## 8. Production-promotion eligibility

POLICY_B remains non-production until a separate promotion milestone with explicit approval.
No production code, thresholds, prompts, or datasets were modified.

## 9. Integrity

- DB_WRITES = 0
- SUPABASE_CONTACT = false
- Production threshold remained 0.85
- Production embedding unchanged
- Dataset unchanged
- Historical artifacts untouched