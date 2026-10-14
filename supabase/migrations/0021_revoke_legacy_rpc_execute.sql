-- ============================================================
-- 0021_revoke_legacy_rpc_execute.sql
-- Aether Memory V2 | Phase 6-AO — Step 4 (REVISED FOR M7-A34)
-- ============================================================
-- STATUS (M7-A42): APPLIED AND RECORDED on the LOCAL development
-- database only (docker supabase_db_aether-v2); recorded in its
-- local migration history as version 0021
-- (revoke_legacy_rpc_execute). Remote application remains UNAPPROVED
-- and owner-gated; nothing here implies or authorizes applying this
-- file to any remote project. See header comments for the
-- full scope, the 0018/0021 relationship, and the prereqs.
--
-- M7-A34 CORRECTION NOTES (vs the previous draft):
--   1. The five BLOCKED overloads are now revoked from
--      `public, anon AND authenticated` — the previous draft
--      revoked only `public, anon`, which left `authenticated`
--      (the role the API actually runs as) fully able to execute
--      every "blocked" function. That defeated the audit.
--   2. touch_memories(uuid, uuid[]) was previously listed BOTH as
--      BLOCKED and in the GRANT list. RESOLVED: GRANT. The chain
--      never created an unguarded 2-arg variant (0004/0006
--      created only 1-arg; 0019 created the 2-arg WITH
--      user_id=p_user_id scoping — LIVE BODY VERIFIED). The live
--      retrieval path calls it (retrieve.ts -> touchMemories).
--   3. find_near_duplicates(uuid, vector, double precision) was
--      listed BOTH as revoke-only and in the GRANT list. M7-A39
--      resolved it as REVOKE ONLY (no grant): a fresh caller audit
--      of the current tree found NO live caller, and the body has
--      no auth.uid() guard.
--   4. Four statements target signatures that exist ONLY on the
--      remote dev project (verified absent from the local
--      catalog). They are wrapped in to_regprocedure DO-blocks so
--      the file validates everywhere and still applies where the
--      signatures exist.
--   5. Every factual claim below was re-verified against LIVE
--      pg_proc.prosrc of the local DB. Two prior-draft claims
--      were false and are corrected in place (apply_memory_decay,
--      merge_memories evidence notes).
--
-- Purpose: permanently remove API-role execute access to the
-- legacy SECURITY DEFINER RPC overload families that predate the
-- 0018/0019 hardening wave, while retaining `authenticated`
-- on the guarded/app-needed overloads. Scope: permission changes
-- only — no bodies, no signatures, no drops, no table grants,
-- no RLS changes.
--
-- Prerequisites: 0019 MUST be applied before this file (source of
-- the guarded overloads). On the LOCAL database only, 0018 was
-- applied and recorded in its migration history during M7-A36-A38,
-- so the purge_archived(uuid, integer) guard prerequisite is
-- satisfied there. Remote application, promotion, and approval of
-- 0018 and 0021 remain fully owner-gated; nothing here implies
-- 0018 is applied remotely. Remote project must NOT receive this
-- file until the owner approves.
--
-- Validation record (M7-A34): validated against LOCAL Supabase
-- Postgres (docker supabase_db_aether-v2) inside a controlled
-- transaction that was ROLLED BACK. No remote database contacted.
-- Local application record (M7-A42): that same validation was
-- subsequently re-verified and then APPLIED for real to that LOCAL
-- database with ON_ERROR_STOP (zero errors); every ACL check passed,
-- and the migration was recorded in that database's LOCAL migration
-- history as version 0021. No remote database was contacted then
-- either; remote application of 0021 remains fully owner-gated and
-- unapproved.
-- ============================================================
-- =====================================================================
-- BLOCKED — revoked from `public`, `anon` AND `authenticated`.
-- NEVER grant these back to any API role. Evidence cited per entry
-- is from the LIVE local catalog (pg_proc.prosrc / proacl).

-- ---- forget_archived: 1-arg legacy version (M7-A31 V1)
-- LIVE BODY VERIFIED: unconditional global sweep (`update memories
-- set status='deleted' where status='archived' ...`) with NO user
-- scope and NO auth.uid() guard, SECURITY DEFINER => any caller can
-- delete ANY user's archived memories. No app caller exists (the
-- app calls purge_archived; grep found zero rpc callers).
-- REVOKE ONLY, including from `authenticated`. Do NOT grant back.
-- =====================================================================
revoke all on function public.forget_archived(integer) from public, anon, authenticated, service_role;

-- ---- merge_memories: 2-arg legacy version (M7-A31 V2)
-- LIVE BODY VERIFIED: the guard is `if auth.uid() <> keep_user then
-- raise` — when auth.uid() is NULL the comparison is NULL, the raise
-- does not fire, and the function PROCEEDS on an unverified
-- keep-user => cross-user merge/delete plus memory_edges /
-- memory_events writes under SECURITY DEFINER. No app caller
-- (dead code). REVOKE ONLY, including from `authenticated`.
-- =====================================================================
revoke all on function public.merge_memories(uuid, uuid[]) from public, anon, authenticated, service_role;

-- ---- match_memories: 3-arg legacy version (M7-A31 V3)
-- LIVE BODY VERIFIED: NO auth guard; `where m.user_id = match_user`
-- trusts the caller-supplied match_user and returns full content
-- under SECURITY DEFINER => arbitrary cross-user full-content read.
-- The repository still EXPORTS a legacy matchMemories() bridge to
-- this signature, but the live retrieval path was migrated to
-- match_memories_v2 and no live caller of the bridge remains
-- (unit tests only mock the repository layer), so removing
-- `authenticated` is app-safe. Deleting the dead bridge is a
-- separate CODE change (out of scope here).
-- REVOKE ONLY, including from `authenticated`. Do NOT grant back.
-- =====================================================================
revoke all on function public.match_memories(vector, uuid, integer) from public, anon, authenticated, service_role;

-- ---- touch_memories: legacy 1-arg uuid[] variant (M7-A31 V5b)
-- LIVE BODY VERIFIED (0006 definition): SECURITY INVOKER update of
-- `where id = any(p_ids)` with NO user scope. Not SECURITY DEFINER,
-- but RLS-bypassing callers and service-role paths can still touch
-- arbitrary ids, and the app never calls the 1-arg form (the live
-- path is the guarded 2-arg from 0019, granted below).
-- REVOKE ONLY. Do NOT grant back.
-- =====================================================================
revoke all on function public.touch_memories(uuid[]) from public, anon, authenticated, service_role;

-- ---- apply_memory_decay: 1-arg (M7-A31 V7) — ORDERED BLOCKED,
-- ---- with a factual correction to the prior draft
-- CORRECTION: the prior draft claimed "no auth guard, no user scope
-- -> decays EVERY user's memories". FALSE for the current chain.
-- LIVE BODY VERIFIED: carries `if auth.uid() is null or auth.uid()
-- <> p_user_id then raise` AND scopes the sweep to
-- `user_id = p_user_id` (already true in 0004, preserved by 0019).
-- However, no app caller exists anywhere in the repo and M7-A31/A34
-- order it revoked as legacy-family hygiene: an unused SECURITY
-- DEFINER function should not stay API-executeable. The owner may
-- restore it with a one-line GRANT if a future maintenance path
-- wants it. REVOKE ONLY, including from `authenticated`.
-- =====================================================================
revoke all on function public.apply_memory_decay(uuid) from public, anon, authenticated, service_role;

-- =====================================================================
-- REVOKE-ONLY (hygiene) — revoked from `public` and `anon`. These are
-- superseded or remote-only legacy signatures; `authenticated` handling
-- is decided explicitly per entry below (some are re-granted).
-- =====================================================================

-- ---- match_memories: legacy 4-arg NULL-safe-guard variant (M7-A31 V3b)
-- REMOTE-ONLY SIGNATURE: verified absent from the local catalog (no
-- migration in 0000-0020 creates match_memories(vector, uuid, int, int)).
-- Guarded with to_regprocedure so this file validates on databases
-- that do not have it and still applies where it exists.
-- =====================================================================
do $$
begin
  if to_regprocedure('public.match_memories(vector, uuid, integer, integer)') is not null then
    execute 'revoke all on function public.match_memories(vector, uuid, integer, integer) from public, anon';
  end if;
end $$;

-- ---- find_near_duplicates: 3-arg (M7-A31 V6a)
-- 0004 and 0019 declare the SAME identity args (uuid, vector, float8);
-- 0019's CREATE OR REPLACE overwrote the body. LIVE BODY VERIFIED:
-- user-scoped (`m.user_id = p_user_id`) but NO auth.uid() guard — the
-- caller supplies p_user_id. M7-A39 caller re-audit (current tree):
-- the only repository mention is a DEFERRED comment; no `.rpc()` call
-- to this function exists anywhere in app, lib, scripts, or tests.
-- REVOKE ONLY, including from `authenticated` (grant removed M7-A39).
-- =====================================================================
revoke all on function public.find_near_duplicates(uuid, vector, double precision) from public, anon, authenticated, service_role;

-- ---- find_near_duplicates: legacy 2-arg variant (M7-A31 V6b)
-- REMOTE-ONLY SIGNATURE (verified absent from the local catalog).
-- Guarded with to_regprocedure.
-- =====================================================================
do $$
begin
  if to_regprocedure('public.find_near_duplicates(vector, double precision)') is not null then
    execute 'revoke all on function public.find_near_duplicates(vector, double precision) from public, anon';
  end if;
end $$;

-- ---- apply_memory_decay: legacy 2-arg variant (M7-A31 V7b)
-- REMOTE-ONLY SIGNATURE (verified absent from the local catalog).
-- This statement was previously misplaced AFTER the purge_archived
-- "nothing below this line" note; relocated here. Guarded with
-- to_regprocedure.
-- =====================================================================
do $$
begin
  if to_regprocedure('public.apply_memory_decay(uuid, integer)') is not null then
    execute 'revoke all on function public.apply_memory_decay(uuid, integer) from public, anon';
  end if;
end $$;

-- ---- match_memories_v2: legacy 7-arg (M7-A31 V8) — FIXED HANDLING
-- CORRECTION to the prior draft: it claimed this body "carries no
-- auth.uid() guard". LIVE BODY VERIFIED: the 7-arg body DOES carry
-- `if auth.uid() is null or auth.uid() <> p_user_id then raise`.
-- It is revoked here as hygiene because it is superseded by the
-- 4-arg guarded match_memories_v2(uuid, vector, float8, int) — the
-- family should have exactly one app-facing overload. public/anon
-- revoked; `authenticated` is NOT granted back here — but note this
-- statement does not remove it either: any pre-existing explicit
-- `authenticated` grant (guarded body, verified) is retained by
-- design. Stripping it would be a separate owner decision.
-- =====================================================================
revoke all on function public.match_memories_v2(vector, uuid, integer, double precision, text[], text[], uuid) from public, anon, service_role;

-- ---- match_memories_v2: guarded 4-arg live retrieval RPC (M7-A31 V8)
-- THE live retrieval RPC (lib/memory/retrieve.ts -> matchMemoriesV2).
-- LIVE BODY VERIFIED: carries the auth.uid() ownership guard AND
-- scopes by user_id = p_user_id. Grant `authenticated`.
-- =====================================================================
-- M7-A57, extended by M7-A59: explicit revoke first so this live RPC's ACL is
-- deterministic and independent of the target's default function ACL. PUBLIC,
-- anon, and service_role EXECUTE are all revoked here (a fresh/stock Postgres
-- grants EXECUTE to PUBLIC by default, and Supabase's default ACL additionally
-- grants service_role; the CLI-managed local stack masked both). `authenticated`
-- is re-granted on the next line.
revoke execute on function public.match_memories_v2(uuid, vector, double precision, integer) from public, anon, service_role;
grant execute on function public.match_memories_v2(uuid, vector, double precision, integer) to authenticated;

-- ---- touch_memories: guarded 2-arg variant (M7-A31 V5) — GRANT
-- RESOLUTION of the BLOCKED-vs-GRANT contradiction (header note 2):
-- the chain never created an unguarded 2-arg variant. 0004/0006
-- created only the 1-arg (revoked above); 0019 created this 2-arg
-- WITH `user_id = p_user_id` scoping — LIVE BODY VERIFIED. The live
-- retrieval path calls it (lib/memory/retrieve.ts -> touchMemories;
-- also the agent learning apply path). Grant `authenticated`.
-- RESIDUAL RISK (owner note): user-scoped but NO auth.uid() guard;
-- a caller could pass another user's p_user_id. Impact is bounded
-- to incrementing times_used/last_used on named rows; body fix is a
-- 0019-family change, out of scope for this permissions-only file.
-- =====================================================================
-- M7-A57, extended by M7-A59: explicit revoke first so this live RPC's ACL is
-- deterministic and independent of the target's default function ACL (see the
-- match_memories_v2 note above). PUBLIC, anon, and service_role EXECUTE are all
-- revoked; `authenticated` is re-granted on the next line.
revoke execute on function public.touch_memories(uuid, uuid[]) from public, anon, service_role;
grant execute on function public.touch_memories(uuid, uuid[]) to authenticated;

-- ---- find_near_duplicates: 3-arg (M7-A31 V6a) — GRANT REMOVED (M7-A39)
-- M7-A34 had granted this because the audit ordered it; M7-A39
-- re-audited the current tree and found NO live caller (the only
-- repository mention is a DEFERRED comment; zero `.rpc()` calls
-- anywhere). With no caller and a body that is user-scoped but has
-- NO auth.uid() guard (caller-supplied p_user_id could read
-- another user's id/title/similarity/metadata), the safe posture is
-- revoke-only like the other blocked families. Statement replaced
-- by the REVOKE ONLY entry above. If a future dedupe path needs
-- this RPC, re-add the grant together with a body-level guard.
-- =====================================================================
-- (no statement: intentionally ungranted)

-- ---- match_memories: 4-arg (M7-A31 V3c)
-- REMOTE-ONLY SIGNATURE: no migration in the local chain creates
-- match_memories(vector, uuid, float8, int). Guarded with
-- to_regprocedure so this file validates locally and still grants
-- where the overload exists. Owner should confirm this overload's
-- body carries an auth guard before promotion beyond local
-- validation.
-- =====================================================================
do $$
begin
  if to_regprocedure('public.match_memories(vector, uuid, double precision, integer)') is not null then
    execute 'grant execute on function public.match_memories(vector, uuid, double precision, integer) to authenticated';
  end if;
end $$;

-- =====================================================================
-- purge_archived() — a SEPARATE AUDIT DECISION (0018 owns it).
-- LOCAL HISTORY UPDATE (M7-A36-A38): 0018 was applied to the LOCAL
-- database only and recorded in its local migration history; the
-- live local purge_archived(uuid, int) is now the guarded 0018 body
-- (auth.uid() guard + pinned search_path + authenticated-only ACL,
-- verified). This file's earlier statement — that 0018 was absent
-- from local history and the live body was the 0007 version — was
-- true at the time and is superseded by that validation.
-- Nothing here implies 0018 is applied anywhere but that local
-- database; remote application and approval stay fully owner-gated.
-- 0021 intentionally does NOT grant, revoke, or recreate
-- purge_archived — that repair belongs to 0018, not to this file.
-- =====================================================================
-- purge_archived intentionally has NO statement in this file.

-- Intentional: nothing in this file touches function bodies,
-- signature changes, drops, table grants, or RLS. 0018 untouched.
-- END OF 0021.

