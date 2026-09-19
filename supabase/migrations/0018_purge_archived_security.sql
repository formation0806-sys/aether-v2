-- =============================================================
-- 0018_purge_archived_security.sql
-- Aether Memory V2 | Phase 6-AO — Step 3 (DRAFT ONLY — do NOT apply)
--
-- SECURITY REPAIR: public.purge_archived(uuid, integer)
--
-- Verified defect (Phase 6-AO Step 1 "purge_archived security gap",
-- and Step-3 "Current verified problem"):
--   * function is SECURITY DEFINER
--   * search_path is unpinned (no SET search_path)
--   * no auth.uid() ownership guard
--   * EXECUTE exposed to PUBLIC/anon (and, by PUBLIC membership,
--     authenticated and service_role)
-- Because p_user_id is attacker-supplied and the function is
-- SECURITY DEFINER, an arbitrary p_user_id can address another
-- user's archived memories -> arbitrary cross-user deletion.
--
-- Sole production caller chain (UNCHANGED by this migration):
--   app/api/chat/route.ts -> processMemoryJobs -> runMemoryMaintenance
--       -> purgeArchived(userId) under role `authenticated`
-- For that legitimate path auth.uid() == p_user_id, so the new guard
-- passes; it only blocks injected user ids.
--
-- This file contains ONLY:
--   1. CREATE OR REPLACE FUNCTION public.purge_archived(...)
--      Body preserved BYTE-FOR-BYTE from 0007 (archived -> deleted,
--      make_interval grace, identity/procedural exclusion, row-count
--      return). ADDS: SET search_path = public + auth.uid() guard.
--      SECURITY DEFINER preserved.
--   2. Privilege repair: REVOKE EXECUTE FROM PUBLIC, anon; GRANT
--      EXECUTE TO authenticated. Nothing else is invented.
--
-- Intentional deltas vs 0007 (the COMPLETE delta set):
--   + new `set search_path = public` clause
--   + new ownership-guard block (mirrors 0015:83-85 / 0016:21-23)
--   + new REVOKE/GRANT privilege statements (mirrors 0015:307-311)
-- Preserved verbatim from 0007: signature, `security definer`,
-- `language plpgsql`, the UPDATE (archived -> deleted with grace +
-- identity/procedural exclusion), get diagnostics / return n, param
-- names/types/default(90), returns int.
--
-- Type-spelling note: contract specifies `integer`; 0007 declared `int`.
-- In PostgreSQL `int` is an alias for `integer` = int4 (oid 23): the
-- signature is type-identical / unchanged. Kept as `int` so "signature
-- unchanged" is true byte-for-byte.
--
-- SERVICE_ROLE CONCLUSION (requirement: do not assume; inspect precedent):
--   0007 granted NO privileges; purge_archived's only execute path was the
--   implicit PUBLIC grant (the verified gap). Postgres makes every role an
--   implicit member of PUBLIC, so PUBLIC -> service_role.
--   0018 REVOKEs PUBLIC then GRANTs authenticated; does service_role still
--   resolve a path? VERIFIED by this session's Phase 6-AO Step-1 G-ROLLBACK
--   catalog read of rollback_consolidation, which was created by 0015 with
--   the IDENTICAL idiom
--     (revoke all ... from public, anon; grant execute ... to authenticated;
--      NO explicit service_role grant)
--   and whose LIVE remote ACL resolved to exactly {authenticated, postgres,
--   service_role}. => In THIS project service_role inherits `authenticated`'s
--   grants. => The contract's prescribed REVOKE/GRANT is sufficient;
--      service_role retain is NOT at risk.
--   NO service_role grant is added (honoring "do not invent additional
--   grants"). If a future audit shows service_role is NOT a member of
--   authenticated in a given tenant, the minimal fix would be a single
--   `grant execute ... to service_role;` appended to this file and flagged
--   for human approval — but that is NOT needed here per the verified ACL.
--
-- Migration-level DML check: NO statement-level INSERT/UPDATE/DELETE/
-- TRUNCATE/ALTER/DROP. The only UPDATE lives inside the preserved $$
-- body (archived -> deleted) and is expected, not migration-level.
-- Contains exactly ONE `create or replace function`.
--
-- Frozen-scope note: 0000-0017 are NOT modified by this file.
-- ============================================================

create or replace function purge_archived(
    p_user_id uuid,
    p_grace_days int default 90
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0;
begin
    -- Ownership guard (mirrors 0015:83-85 / 0016:21-23). Blocks an
    -- arbitrary p_user_id from addressing another user's rows through
    -- this SECURITY DEFINER function.
    if auth.uid() is null or auth.uid() <> p_user_id then
        raise exception 'not authorized';
    end if;

    update memories
    set status = 'deleted'
    where user_id = p_user_id
      and status = 'archived'
      and updated_at < now() - make_interval(days => p_grace_days)
      and memory_type not in ('identity','procedural');
    get diagnostics n = row_count;
    return n;
end $$;

-- Privilege repair (posture mirrors 0015:307-311 / 0016 exactly):
-- revoke execute from PUBLIC and anon, grant execute to authenticated only.
-- No service_role grant added (see SERVICE_ROLE CONCLUSION above).
revoke execute on function public.purge_archived(uuid, int) from public, anon;
grant execute on function public.purge_archived(uuid, int) to authenticated;
