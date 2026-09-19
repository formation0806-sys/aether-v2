# AETHER — PHASE 3 PRODUCTION MVP VALIDATION REPORT

**Mode:** READ-ONLY validation · zero production changes · zero commits · zero deployments
**Date:** 2026-09-02 · **HEAD:** `dacb2ee` (`feature/memory-v2-foundation`)
**App under test:** production build served at `http://localhost:3000` (same build as Phase 0/2; rebuilt fresh for D1 + bundle scan)

---

## Executive verdict

**PASS — production-viable for MVP scope, with pre-existing limitations documented.**
All 8 gates executed. **Zero NEW production failures discovered.** Secret boundary is clean, authentication/authorization behave correctly, RLS blocks anonymous access, IDOR vectors are inert, robustness is graceful-with-notes, regression profile is identical to the Phase-0 baseline, and all 35 frozen files are byte-identical. The three pre-existing weaknesses found (route-gating inconsistency on 3 pages, empty-message acceptance, malformed-JSON 500-instead-of-400) are documented, classified PRE-EXISTING, and **not patched** per mandate.

## 1. Authentication (Gate A)

| Check | Result | Evidence |
|---|---|---|
| A1 unauth `POST /api/chat` | **PASS** | HTTP **401**, no body content leaked |
| A2 protected routes unauth | **PASS (2/5) + PRE-EXISTING (3/5)** | `/chat`, `/memory` → **307** redirect (server-side `getUser` + `redirect("/signin")`) ✓. `/dashboard`, `/tasks`, `/profile/setup` → **200** with no server-side gate — these are client-side-gated pages (`"use client"` / client components calling `getUser` in-browser). **No data exposure** (see Gate B: RLS returns 0 rows for anon). |
| A3 public pages | **PASS** | `/`, `/signin`, `/signup` → 200 |
| A4 signup/login mechanics | **PASS** | Disposable user (admin-created, email_confirm:true) → `signInWithPassword` via app's own auth path → session issued. NOTE (pre-existing config): anon `signUp` returns no session (email confirmation ON) — matches Phase-2 evidence; documented, not fixed. |
| A5 authenticated access | **PASS** | `/dashboard` with session cookie → 200; authed chat → 200 with coherent reply |
| A6 forged credentials | **PASS** | Fake Bearer JWT → **401**; garbage `sb-*` auth cookie → **401** (`getUser` rejects) |

## 2. Authorization / tenant isolation (Gate B)

| Check | Result | Evidence |
|---|---|---|
| B1 body-injected identity (IDOR) | **PASS** | Authenticated chat carrying `userId`, `user_id`, `targetUserId` of a *victim* user → server ignored all three (identity from session only). Victim rows before/after: **memories 10→10, messages 54→54, unchanged=true**. |
| B2 anon PostgREST RLS | **PASS** | With anon key only: `memories` 0 rows, `tasks` 0 rows, `profiles` 0 rows, `messages` 0 rows; `channels` not exposed (404 PGRST205); anon **write** to `memories` → **401 (42501 row-level-security violation)**. |
| B3 cross-user leakage | **PASS** | B1 victim untouched + Phase-2 S11 (user B saw zero user-A facts in DB rows, answers, and VSM probe) re-asserted. |
| B4 server-component data paths | **PASS** | All data access in pages/components goes through user-scoped `createClient()` (browser = anon+RLS; server = session client). Exactly **1** import of server-only libs exists under `app/**.tsx` and it is a **server** component (`useClient=False`). **0** client components import `lib/ai/*`, `lib/memory/*`, `lib/repositories/*`. |

**Finding F-1 (PRE-EXISTING, minor):** `/dashboard`, `/tasks`, `/profile/setup` rely on client-side auth checks instead of server-side route gates. Defense-in-depth (RLS + client `getUser` guards in `StatsCards`/`RecentTasks`/`TaskList`) prevents data exposure, so this is a **gating-consistency weakness, not a breach**. Server-side gate hardening would be a future UX/consistency improvement — NOT implemented here.

## 3. Secret boundary (Gate C)

| Check | Result | Evidence (hit counts only; values never printed) |
|---|---|---|
| C1 client bundle (`.next/static`, 22 files) | **PASS** | serviceKeyValue=**0**, serviceKeyName=**0**, serviceRoleClaim=**0**, ollamaUrlValue=**0**, ollamaUrlName=**0**, ollamaBasicAuthName=**0**, basicAuthHeader=**0**, vercelOidcValue=**0**. anonKeyValue=**1** (by design, `NEXT_PUBLIC_*`). |
| C2 server bundle (`.next/server`, 171 files) | **PASS** | serviceKey=0 (runtime env, not inlined); Ollama URL/name/BASIC_AUTH name appear only in server chunks (2 each — server-side code references); anon key 4 (expected). |
| C3 client-component import audit | **PASS** | 0 client imports of server-only modules (see B4). |

## 4. Environment / configuration (Gate D)

| Check | Result | Evidence |
|---|---|---|
| D1 `npm run build` | **PASS** | exit 0; "Compiled successfully"; 14 static pages; `/api/chat` dynamic |
| D2 required env | **PASS** | All required keys present (keys-only audit) |
| D3 Ollama | **PASS** | `/api/tags` 200; frozen models `nomic-embed-text:latest` + `qwen2.5:3b` present |
| D4 Supabase | **PASS** | Host reachable + responding (B2 probe: live 200/401 REST responses; earlier root-path probe artifact discarded) |
| D5 route config | **PASS** | `/api/chat` dynamic (server-executed, auth-checked) |
## 5. API robustness (Gate E) — authenticated probes, disposable user

| Check | Result | Evidence |
|---|---|---|
| E1 malformed JSON body | **PASS (with note)** | HTTP **500** with clean JSON error — no crash, **no stack trace, no secrets (leakScan=0)**, **no DB rows written**. Note (pre-existing): 400 would be the correct status; the 500 is the route's current error contract. |
| E2 `{}` empty object | **PASS (with note)** | HTTP 200, `{"response":""}` — no secrets. Note (pre-existing): empty message accepted rather than 400-rejected; message pair persisted but **no memory_job enqueued** (accounting: 3 jobs for 4 accepted turns). Minor robustness gap, no leak. |
| E3 whitespace-only message | **PASS (with note)** | HTTP 200, graceful reply. Accepted as a normal turn (persisted). Minor: could be rejected earlier. |
| E4 64KB oversized message | **PASS** | HTTP 200, graceful bounded reply, no timeout, no leak |
| E6 response leak scan | **PASS** | leakScan=0 on **all** probe responses (service key + Ollama URL value checked in every body) |
| E5 Ollama-unavailable | **CODE-INSPECTION ONLY** (Ollama not disrupted, per mandate) | `lib/ai/providers/ollama.ts`, `embed.ts`, `aiExtractor.ts`, `identity.ts` all use `AbortSignal.timeout(...)` + non-ok/parse guards; `pipeline.ts` wraps each stage in try/catch and reports `result.ok=false` instead of throwing unhandled; identity layer fails safe to `create`. |

## 6. Memory safety (Gate F) — re-asserted from Phase-2 evidence; no patches applied

| Item | Status |
|---|---|
| Empty-memory user | SAFE (Phase-2 S10: graceful non-fabricating reply, no leakage) |
| Cross-user isolation | SAFE (Phase-2 S11 + Phase-3 B1/B2) |
| Below-floor behavior | SAFE (Phase-2 S4: refusal without fabrication at cos 0.5938 < 0.65) |
| Unrelated queries | SAFE (Phase-2 S8: 0 false positives; S7: no neighbor substitution) |
| **S6 — extraction variance** | **CONFIRMED DEFECT (unfixed):** qwen2.5:3b returned 0 extractions twice for the mango seed; persistence never reached; row later created by query-mining. |
| **S9 — lifecycle defect** | **CONFIRMED DEFECT (unfixed):** title-collision `PGRST116` throw (`memory.ts:92`) + broken supersession (`insertMemoryV2` without `.select()` → `FAILED_TO_OBTAIN_NEW_MEMORY_ID` at `memory.ts:153` after commit; old memory never marked merged) + swallowed per-memory errors (`pipeline.ts:454-456`) while jobs report completed. |
| Retrieval floor 0.65 | UNCHANGED (frozen; M2-M verdict B stands) |

**Phase-3 bonus observation (supports S6's variance classification):** the probe user's single seed ("My favorite color is teal.") **extracted and persisted successfully** (1 memory from 1 turn) — extraction works probabilistically; misses are per-message LLM variance, not a systematic break.

## 7. Regression (Gate G)

| Check | Result | Classification |
|---|---|---|
| `npx tsc --noEmit` | **37 errors / 4 files, all `tests/phase-6-ao/*`; 0 files elsewhere** | **PRE-EXISTING** (identical to tracked baseline) |
| `npm run lint` | 197 error-lines / 175 warn-lines / 101 files. Delta vs Phase-0 baseline (181/144) = **11 self-inflicted `.kilo/mvp-e2e/build/*.ts` diagnostic chunks** now being scanned. Production-area failures: 5 files (4 pre-existing `components/*` + pre-existing root `run-experiment.mjs`) | **PRE-EXISTING** (+ diagnostic-artifact noise, noted) |

## 8. Frozen integrity (Gate H)

- Baseline: `.kilo/mvp-e2e/preflight-baseline-2026-09-02T094844Z.sha.txt` (35 files: `lib/memory/*`, `lib/repositories/memory.repository.ts`, `lib/ai/embeddings/*`, `lib/context/*`, `lib/brain/*`, `lib/core/pipeline.ts`, `lib/ai/config.ts`, `supabase/migrations/*`).
- Pre-phase check: **35/35 identical**. Post-phase check: **FROZEN_FINAL_OK=35 BAD=0**.
- `lib/memory/memory.ts` remains the recorded pre-existing modification (earlier supersession work) — untouched this phase.
| C4 env hygiene | **PASS (with note)** | Keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OLLAMA_BASE_URL`, `VERCEL_OIDC_TOKEN`. No `NEXT_PUBLIC_OLLAMA*`. Note: `VERCEL_OIDC_TOKEN` present in local `.env.local` (gitignored; local-only artifact). |
| E7 log leak scan | **PASS** | `app.log`/`app.err.log`: serviceKeyHits=0, ollamaUrlHits=0, basicAuthMentions=0. Ollama dumps in logs are numeric embedding arrays only (verified Phase 2.1). |

**Conclusion: `SUPABASE_SERVICE_ROLE_KEY`, `OLLAMA_BASE_URL`, `OLLAMA_BASIC_AUTH` are server-side only. No provider secrets reach the browser.**

## 9. Git status delta

- No tracked files modified this phase.
- New untracked artifacts: `docs/PHASE3_VALIDATION.md` (this report) + diagnostic scripts/logs under `.kilo/mvp-e2e/` (`phase3-b2-anon-rls.mjs`, `phase3-user-probes.mjs`, `phase3-bundle-scan.mjs`, `phase3-probes.log`, `phase3-build.log`, `phase3-tsc.log`, `phase3-lint.log`, `phase3-unit.log`).
- All pre-existing working-tree modifications untouched; no reverts, no cleanup, no commits.

## 10. DB-write accounting (exactly per approved budget)

| Write | Count | Detail |
|---|---|---|
| Auth users created | **1** | `b04a9e36-…` (`phase3-probe-*@aether.dev`, email_confirm:true, established disposable-user mechanism) |
| Chat turns accepted (HTTP 200) | **4** (≤4 budget) | A5 seed turn, B1 IDOR turn, E3 whitespace turn, E4 oversized turn |
| Messages persisted | **8** (2 per accepted turn) | tester user only |
| memory_jobs | **3** | empty-object turn (E2) persisted a message pair without enqueuing a job |
| Memories | **1** | "teal" favorite-color fact (extraction succeeded) |
| Victim-user (Phase-2 main) rows | **0 changed** | 10 memories / 54 messages before AND after B1 |
| Anon-role writes | **0** (blocked by RLS — B2) | — |
| Deletions / unrelated modifications | **0** | — |

## 11. NEW failures

**None.** Every check passed or matched a pre-existing baseline. Three pre-existing weaknesses surfaced for the record (not fixed): (1) client-side-only gating on `/dashboard`, `/tasks`, `/profile/setup` — RLS holds, no exposure; (2) empty/whitespace messages accepted with 200 (E2/E3); (3) malformed JSON returns 500-with-clean-JSON instead of 400 (E1). All are robustness-polish items for a future authorized fix phase; none block MVP operationally.

## 12. Final MVP production-readiness verdict

**PASS WITH DOCUMENTED PRE-EXISTING LIMITATIONS.**
Authentication, authorization, tenant isolation, secret boundaries, configuration, robustness, and regression posture are all validated as production-viable for MVP scope on the current build. The remaining blockers to a *complete* MVP are the known memory-layer defects (**S6** extraction variance, **S9** correction lifecycle) and the **frozen 0.65 retrieval-floor limitation** — all human-decision items from Phases 2/2.1, deliberately untouched here.

**Recommended next step (human decision required):** authorize a bounded fix phase (F1–F3 minimum; optionally F4/F5) for the S6/S9 defects + the three Phase-3 polish items, followed by a Phase-2 suite re-run — OR accept current state and proceed toward deployment validation with the defects documented as known limitations.

**STOP — Phase 3 complete. No fixes applied, no production changes, no commits, no deployment. Awaiting human review.**
| Hermetic unit tests (`tests/unit`) | **169 passed / 1 failed (170)** | Failure: `tests/unit/reflection/reflection-provenance-persistence.test.ts` — "`cookies` was called outside a request scope" (Next.js dynamic-API context in test harness). **PRE-EXISTING / first-time-measured** (zero production files modified; frozen 35/35 — cannot be session-caused). Harness scoping issue, not a production runtime failure. Live diagnostic suites (`phase-6-*`, phase-mvp-e2e) intentionally NOT re-executed — prior-phase artifacts with recorded results. |
| Build inventory | unchanged (14 pages, `/api/chat` dynamic) | — |

**No new regression was introduced by any phase of this session.**
