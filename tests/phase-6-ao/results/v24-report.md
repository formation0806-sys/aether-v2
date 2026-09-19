# PHASE 6-AO-V24 — External Embedding Model Evaluation Report

**Status:** PENDING

## 1. Models evaluated

Inventory: 6 model(s) found: bge-m3:latest, mxbai-embed-large:latest, nomic-embed-text:latest, qwen2.5-coder:7b, qwen2.5:3b, qwen3:4b

Selected candidates: 3
- mxbai-embed-large:latest: dim=1024, evidenceScore=0.90, rationale: mxbai-embed-large: V14/V20 measured best configuration (TP=18, symmetric prefix); already tested, dimension=1024 blocks production adoption per frozen 768-dim contract.
- nomic-embed-text:latest: dim=768, evidenceScore=0.80, rationale: nomic-embed-text: production baseline (768-dim); V11-V20 anchor. Re-testing for control validation only.
- bge-m3:latest: dim=1024, evidenceScore=0.70, rationale: BGE-M3: documented multilingual retrieval strength; evaluated in V19 as external candidate with credible short-paraphrase capability.

## 2. Control reproduction

Control B TP: 18
Control B fixedRecall: 81.82%
pair-005: 0.821145 (expected 0.821145)
pair-007: 0.837367 (expected 0.837367)

## 3. Candidate outcomes

### mxbai_embed_large_latest_armA: Arm A — mxbai-embed-large:latest bare

- Model: mxbai-embed-large:latest
- Documented by: bare text (no documented protocol)
- Dimension: 1024
- TP: 17
- FN: 2
- FP: 0
- FCR: 0.00% (PASS)
- fixedRecall: 77.27%
- recallGainPP: +9.0909
- Gates: recall=false safety=true repeatability=true
- Classification: REGRESSION

### mxbai_embed_large_latest_armB: Arm B — mxbai-embed-large:latest documented protocol

- Model: mxbai-embed-large:latest
- Documented by: upstream documented protocol (mxbai-embed-large:latest)
- Dimension: 1024
- TP: 9
- FN: 0
- FP: 0
- FCR: 0.00% (PASS)
- fixedRecall: 40.91%
- recallGainPP: -27.2727
- Gates: recall=false safety=true repeatability=true
- Classification: REGRESSION

### nomic_embed_text_latest_armA: Arm A — nomic-embed-text:latest bare

- Model: nomic-embed-text:latest
- Documented by: bare text (no documented protocol)
- Dimension: 768
- TP: 15
- FN: 1
- FP: 0
- FCR: 0.00% (PASS)
- fixedRecall: 68.18%
- recallGainPP: 0
- Gates: recall=false safety=true repeatability=true
- Classification: REGRESSION

### bge_m3_latest_armA: Arm A — bge-m3:latest bare

- Model: bge-m3:latest
- Documented by: bare text (no documented protocol)
- Dimension: 1024
- TP: 12
- FN: 1
- FP: 0
- FCR: 0.00% (PASS)
- fixedRecall: 54.55%
- recallGainPP: -13.6364
- Gates: recall=false safety=true repeatability=true
- Classification: REGRESSION

### bge_m3_latest_armB: Arm B — bge-m3:latest documented protocol

- Model: bge-m3:latest
- Documented by: upstream documented protocol (bge-m3:latest)
- Dimension: 1024
- TP: 0
- FN: 0
- FP: 0
- FCR: 0.00% (PASS)
- fixedRecall: 0.00%
- recallGainPP: -68.1818
- Gates: recall=false safety=false repeatability=true
- Classification: REGRESSION

## 4. Target-pair analysis

pair-005 recovery: see arm outcomes
pair-007 recovery: see arm outcomes

## 5. pair-034 safety-decoy treatment (V23)

pair-034 remains in dataset.json with frozen label=SAME. Its verifier rejection (100% DIFFERENT across recorded evaluations) is tracked as an independent safety metric, not a recall FN.

## 6. pair-011 verifier-bound ceiling

pair-011 is verifier-bound (V14 similarity=0.865164 eligible, but SYS_V5 rejects). No embedding change can recover it.

## 7. Integrity

- dataset SHA before === after: true
- identity.ts SHA before === after: true
- protected results files checked: 46
- protected files byte-identical: true

## 8. Conclusion

V24 best arm: mxbai_embed_large_latest_armA — TP=17, recall=77.27%, FCR=0.00%, repeatability=PASS, dim=1024
Classification: REGRESSION
