# AETHER — M2 SMOKE TEST RUNBOOK

## Purpose

`scripts/mvp-smoke.mjs` proves the smallest complete AETHER memory loop **through the real
application path** (HTTP `POST /api/chat` on the served app — not through isolated functions):

```
T1  CHAT → AI RESPONSE → MEMORY EXTRACTION → MEMORY PERSISTENCE (row + 768-dim embedding)
T2  LATER QUERY → RETRIEVAL → MEMORY REACHES CONTEXT → AI RESPONSE
T3  PARAPHRASE → IDENTITY RESOLUTION (SAME) → CORROBORATION → NO DUPLICATE
```

## Preconditions

| Requirement | How the script verifies it |
|---|---|
| Local Ollama up (loopback only) | `GET {OLLAMA_BASE_URL}/api/tags` |
| Frozen models present | `qwen2.5:3b` **and** `nomic-embed-text:latest` in tags |
| Correct Supabase project | URL host ref must equal `sqbdxttrdmlwlmslzznv` — otherwise **hard abort**, no writes |
| Machine clock healthy | Supabase `auth/v1/health` `Date` header vs local clock, tolerance 60 s |
| App served | `GET /api/chat` must answer `405` (POST-only route exists) |
| Smoke session | Dedicated `m2-smoke-<ts>@example.com` signup (anonymous-sign-in fallback); session cookie built in the exact `@supabase/ssr` wire format (`sb-<ref>-auth-token` = `base64-` + base64url(session JSON), chunked at 3180 chars) and validated via `GET / → 200` |

## How to run

```powershell
# 1. Start Ollama (if not running):  ollama serve
# 2. Serve the app:                  npm run start      # http://localhost:3000
# 3. Run the smoke:
node scripts/mvp-smoke.mjs
```

Exit codes: `0` = PASS, `1` = FAIL (stage assertion), `2` = BLOCKED (preflight).
The final line of output is always `SMOKE_RESULT=PASS|FAIL|BLOCKED`, preceded by a JSON summary.

## Stages and evidence

### T1 — "My name is Prince."
- Chat returns 200 with an AI response.
- Polls `memory_jobs` (SELECT-only) until the job for this exact message is `completed`.
- Asserts ≥ 1 `memories` row with `observation_id = <message id>`; picks the fact row
  (`memory_type='identity'` preferred, then content match); asserts the persisted embedding
  has dimension **768**.
- Corroborating server-log markers: `MEMORIES EXTRACTED ≥ 1`, `MEMORY INSERTED`,
  `MAINTENANCE COMPLETED`, `OLLAMA RAW:` (raw extractor JSON).

### T2 — "What is my name?"
- **Deterministic retrieval/context proof:** `memories.times_used` must increase on the fact row.
  `retrieveMemories()` calls the `touch_memories` RPC for exactly the memories surfaced into the
  prompt, so an increment is proof the saved memory was retrieved and placed into context via the
  application path.
- Secondary (recorded, **not** gate-critical because the 3B chat model is nondeterministic):
  the AI response text mentions "Prince".

### T3 — "Quick reminder — my name is Prince."
- Identity resolution must return **SAME** for the paraphrase and the caller must corroborate.
- Proof: a new `memory_events` row with `action='corroborate'`, `memory_id = <fact id>`,
  `message_id = <T3 message id>` (exactly-once per migration 0011), and
  `confidence_v2` increased by **+0.05** (capped at 1.0).
- No-duplicate proof: **no** new `memories` row with the fact's title from the T3 observation.
- If the first attempt fails (e.g. the extractor worded the paraphrase such that similarity fell
  below the frozen 0.85 candidate floor), exactly **one** reworded rerun is made
  ("As I mentioned before, my name is Prince."). A second failure = FAIL.
- **The 0.85 threshold, candidate count 8, verifier model/prompt/options are never modified.**

## Safety rules (enforced in the script)

1. Hard abort unless the Supabase ref is `sqbdxttrdmlwlmslzznv`.
2. Dedicated smoke user only; password is random and never printed/logged.
3. `SUPABASE_SERVICE_ROLE_KEY` is used **exclusively for SELECT-only assertions** and is never
   logged or sent to the application.
4. No migrations are executed; no rows are updated/deleted by the script; cleanup of the smoke
   user's data is a **manual, explicitly approved** step.
5. No production file is modified by this smoke; the frozen identity contract is exercised as-is.

## Known limitations / failure classification

| Failure | Classification |
|---|---|
| `/api/tags` unreachable or models missing | Ollama runtime failure (BLOCKED) |
| Clock skew > 60 s | Environment (BLOCKED; PGRST303 risk) |
| Wrong Supabase ref | Safety abort (BLOCKED) |
| `GET / → non-200` with cookie | Cookie/auth settings mismatch (BLOCKED) |
| Chat non-200 | Application/API failure |
| Job `failed` + `last_error` | Maintenance stage failure (see error) |
| `MEMORIES EXTRACTED 0` with valid `OLLAMA RAW` | Extractor output/parse (model returned `[]` or non-JSON) |
| `times_used` not incremented | Retrieval/context failure (embedding, RPC, score, budget) |
| No `corroborate` event; new row with fact's title | Identity recall failure (paraphrase below 0.85 floor → fail-safe create) |

## Database notes

The app uses a single linked Supabase project (`sqbdxttrdmlwlmslzznv`) for development and the
Vercel deployment. The smoke writes are limited to: one auth user + the memories/messages/jobs/
events that its own three chat messages produce. Manual cleanup (explicitly approved only):

```sql
-- review first, then delete by the smoke user id printed by the script
```
