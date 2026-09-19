# PHASE 6-AO-V21 — PAIR-034 FORENSIC AUDIT

**Phase:** 6-AO-V21  |  **Target:** pair-034  |  **Mode:** READ-ONLY FORENSIC AUDIT

## 1. Status

COMPLETE. No production behavior, dataset content, labels, metrics, or historical
artifacts were modified. The harness is read-only (node:fs/path/crypto + vitest only).

## 2. Scientific question

Is pair-034's frozen SAME label semantically defensible, or is pair-034 a dataset-label
defect / intentionally documented anomaly card whose inclusion in the SAME recall
denominator (22 items) artificially caps the achievable TP ceiling at 18 under the
frozen production contract?

## 3. Frozen pair facts

- pairId: pair-034
- factKey: tools
- label (frozen, authoritative): SAME
- textA: "I use GitHub to store and manage my code."
- textB: "I use GitLab to manage my source code."
- dataset SHA-256: 5B0C8493914AAF9A1E58358292DB8ADBF55B598D225692F1915DC49502DAF049

The label is NOT silently corrected. It is the authoritative frozen fact.

## 4. Dataset evidence

- Total pairs: 43 (SAME=22, DIFFERENT=21)
- Distinct factKeys: 19
- factKey 'tools': SAME=2, DIFFERENT=0
- pair-033 (tools, SAME): "I use GitHub to store and manage my code." / "GitHub is where I keep my source code repositories." — no value-contrast.
- pair-034 (tools, SAME): GitHub vs GitLab — value-contrast.

## 5. FactKey construction-pattern analysis

- value-contrast pairs labeled DIFFERENT: 8 (e.g. pair-002, pair-004, pair-012, pair-016, pair-018, pair-030)
- value-contrast pairs labeled SAME (anomalous): ["pair-005","pair-034"]
- pair-034 value-contrast: true

The corpus otherwise labels value-contrast (distinct concrete entity) pairs DIFFERENT.
pair-034 is the single SAME-labeled value-contrast entry, and the only 'tools' pair that
differs by entity (pair-033 is GitHub/GitHub).

## 6. Semantic decomposition

- entitiesA: ["GitHub"]
- entitiesB: ["GitLab"]
- only in A: ["GitHub"]  (GitHub)
- only in B: ["GitLab"]  (GitLab)
- actions: A=["use","store","manage"] B=["use","manage"]
- value-contrast detected: true

Both texts perform the same action (use/manage source code) but name two distinct concrete
platforms (GitHub vs GitLab). Derived from the literal text, not a hardcoded conclusion.

## 7. Documented-intent evidence

- primary classification: INTENTIONAL_ANOMALY

  - v3-controlled-diagnostic.test.ts [header comment] "distinct concrete entities" → FOUND (indexOf=1735)
  - v3-controlled-diagnostic.test.ts [header] "semantic anomaly / anomaly card" → FOUND (found=true)
  - v3-verifier-retrieval-dataset.json [verifierDiagnostic] "FORCED_SEMANTIC_DECOY + humanLabel=SAME" → FOUND (humanLabelSame=true, forcedDecoy=true)
  - v6-verifier-adoption-review.test.ts [body] "decoy" → FOUND (decoy=1592)
  - v6-verifier-adoption-review.json [targetStabilityCases] "humanLabel=SAME + role=SEMANTIC_DECOY" → FOUND (role=SEMANTIC_DECOY,)
  - v10-post-adoption-observability.test.ts [cases] "anomaly/decoy" → FOUND (found=true)
  - v16-verifier-forensic-audit.json [pairAudits] "label=SAME" → FOUND (labels=SAME,)

Contradiction: Repository documents pair-034 as anomaly/decoy (expected DIFFERENT), yet the frozen label is SAME. The label is NOT automatically 'wrong' — it is a deliberately constructed anomaly card; however it is NOT ordinary ground-truth SAME.

Evidence hierarchy: frozen dataset (1) > recorded artifacts (2) > documentation (3) >
verifier behavior (4) > world knowledge (5). Documentation is treated as construction
intent, NOT automatic ground truth.

## 8. Verifier evidence

- Recorded DIFFERENT verdicts for pair-034: 16
- Recorded SAME verdicts for pair-034: 0
- V16 determinism (agreement=20): true
- V16 ENTITY_MISMATCH rule-aligned (matchesPromptRule=true): true
- V16 rule-independent under VARIANT_A (remove 'different concrete entities' rule): true

Per-artifact recorded verdicts:
  - v4-verifier-decision-boundary.json: DIFFERENT=7, SAME=0 (8 hits)
  - v5-contract-validation.json: DIFFERENT=2, SAME=0 (2 hits)
  - v6-verifier-adoption-review.json: DIFFERENT=2, SAME=0 (5 hits)
  - v11-band-probe.json: DIFFERENT=1, SAME=0 (2 hits)
  - v14-embedding-prefix-evaluation.json: DIFFERENT=0, SAME=0 (0 hits)
  - v15-error-boundary-diagnostic.json: DIFFERENT=0, SAME=0 (2 hits)
  - v17-verifier-policy-evaluation.json: DIFFERENT=0, SAME=0 (0 hits)
  - v18-verifier-policy-generalization.json: DIFFERENT=0, SAME=0 (0 hits)
  - v20-asymmetric-instruction-evaluation.json: DIFFERENT=0, SAME=0 (0 hits)
  - v16-verifier-forensic-audit.json: DIFFERENT=4, SAME=0 (5 hits)

Distinction maintained: 'verifier says DIFFERENT' (measurement) is NOT conflated with
'dataset ground truth is DIFFERENT' (frozen label = SAME).

## 9. Benchmark validity

- classification: INVALID_FOR_BINARY_BENCHMARK + VALID_AS_SAFETY_DECOY
  - pair-034 is frozen in the 22-SAME denominator but its content is clearly DIFFERENT (GitHub vs GitLab).
  - As a SAME recall item it is unsatisfiable: 16 DIFFERENT vs 0 SAME recorded verdicts.
  - As a decoy it is documented (v3 FORCED_SEMANTIC_DECOY; v6 role=SEMANTIC_DECOY; v16 decoy held).

## 10. Final classification

- classification: CLEAR_DIFFERENT
- caseE (intentional anomaly / policy-boundary mismatch): true
- potentialLabelIssue: true

  - Label: SAME (frozen, authoritative). Content: textA names GitHub; textB names GitLab — distinct concrete platforms (value-contrast=TRUE).
  - Documented intent: INTENTIONAL_ANOMALY. Repository repeatedly treats pair-034 as a semantic anomaly/decoy (expected DIFFERENT).
  - Verifier evidence: DIFFERENT in 16 recorded verdicts, SAME in 0 (V16 20/20 DIFFERENT, ENTITY_MISMATCH rule-aligned).
  - Corpus pattern: 'tools' factKey has only SAME pairs; pair-034 is the only SAME-labeled value-contrast entry while analogous value-contrast pairs are DIFFERENT.
  - Conclusion: content is CLEAR_DIFFERENT; the frozen SAME label is a documented anomaly/decoy — the pair is a dataset-label defect for the binary SAME-recall benchmark but VALID as a safety decoy.

## 11. CASE-E assessment

CASE-E = true (intentional anomaly / policy-boundary mismatch).
Repository documentation characterizes pair-034 as a semantic anomaly / SEMANTIC_DECOY
(v3 FORCED_SEMANTIC_DECOY + humanLabel SAME; v6 role=SEMANTIC_DECOY; v10/v16 decoy language).

## 12. TP-ceiling consequence

- pair-034 in 22-SAME denominator: true
- frozen SAME denominator size: 22
- recorded DIFFERENT/SAME for pair-034: 16/0

Under the frozen production contract the TP ceiling = 18 (v11-report.md §8: fixed-corpus SAME recall TP/22 = 0.8182). pair-034 is a SAME-labeled decoy deterministically rejected by SYS_V5 in 100% of recorded evaluations — a dataset/verifier disagreement. V21 does NOT recompute the gate, change the denominator, relabel, or alter production behavior.
V21 does NOT recompute the gate, change the denominator, relabel, or alter production behavior.

## 13. Metadata / documentation hygiene findings

- pair-034 source field length: 49764
- source encoding corruption (mojibake): true
- LABEL_RATIONALE_FROM_METADATA: LABEL_RATIONALE_FROM_METADATA = NOT_RECOVERABLE
- The corpus-wide 'source' field exhibits severe encoding corruption; the original human
  labeling rationale is NOT recoverable and is reported as NOT_RECOVERABLE (not reconstructed).
- Stale status metadata in historical artifacts (e.g. V16 JSON status PENDING while measured
  data is complete) is NOT modified; measured data is preferred over status fields.

## 14. Zero-write / integrity verification

- DB_WRITES = 0
- SUPABASE_CONTACT = false
- OLLAMA_CONTACT = false
- NETWORK_CONTACT = false
- PRODUCTION_CODE_MODIFIED = false
- DATASET_MODIFIED = false
- HISTORICAL_ARTIFACTS_MODIFIED = false
- dataset SHA before === after: true
- identity.ts SHA before === after: true
- protected (non-v21) results files byte-identical: 50 files checked

## 15. Files created

- tests/phase-6-ao/v21-pair-034-forensic-audit.test.ts
- tests/phase-6-ao/results/v21-pair-034-forensic-audit.json
- tests/phase-6-ao/results/v21-report.md

## 16. Verification commands / results

```
npx vitest run tests/phase-6-ao/v21-pair-034-forensic-audit.test.ts   # expect: PASS
npx tsc --noEmit --incremental false --pretty false                    # expect: no errors
npm run build                                                      # expect: success
git status --short                                                 # expect: only the 3 V21 files
```

## 17. Scope limitations

- V21 scope is pair-034 ONLY. Other SAME-labeled value-contrast pairs (if any) are
  reported as FUTURE_AUDIT_OBSERVATION, not adjudicated.
- No full corpus relabeling audit is performed.
- No model / Ollama / network / DB calls are made.

## 18. Recommendation for next milestone

Treat pair-034 as a documented CASE-E anomaly/decoy: keep its SAME label frozen (do not
mutate the dataset or the production contract), but record the TP-ceiling consequence
(frozen TP=18) and document that pair-034 is a known SAME-recall unsatisfiable item. If a
future milestone re-derives the benchmark denominator, exclude or explicitly flag
pair-034 as a decoy rather than ordinary ground-truth SAME. No production code change
is warranted by this audit.
