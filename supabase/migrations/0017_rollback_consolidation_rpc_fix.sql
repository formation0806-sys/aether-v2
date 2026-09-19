-- ============================================================
-- 0017_rollback_consolidation_rpc_fix.sql
-- Aether Memory V2 | Phase 6-AO Step 2 (D1 repair)
--
-- Repairs the broken advisory-lock argument inside
-- rollback_consolidation(uuid, uuid).
--
-- Defect (verified live, PostgreSQL 17.6, project sqbdxttrdmlwlmslzznv):
--   The 0015 body passed a text literal as the second argument of
--   hashtextextended(text, bigint), so the first invocation would fail
--   with SQLSTATE 42883 (function hashtextextended(text, text) does
--   not exist). consolidate_memories was already repaired with the
--   authoritative idiom in 0016; this migration applies the identical
--   idiom to rollback_consolidation.
--
-- Scope contract:
--   * ONLY the advisory-lock argument changes:
--       hashtextextended(p_user_id::text, 'consolidate'::text)
--         -> hashtextextended(p_user_id::text, hashtext('consolidate'))
--   * Signature, SECURITY DEFINER, search_path = public, ownership
--     guards, event/edge semantics, idempotency and results are
--     preserved byte-for-byte from 0015 (lines 219-304).
--   * No ACL statements: CREATE OR REPLACE FUNCTION preserves the
--     existing privileges granted by 0015 (same precedent as 0016).
--   * Contains NO INSERT/UPDATE/DELETE/TRUNCATE/GRANT/REVOKE/DDL at
--     migration level. (The UPDATE/DELETE statements inside the $$ body
--     are the preserved rollback semantics themselves.)
--   * The five Phase-6-AN fixture rows are intentionally NOT touched.
--   * This migration has NOT been applied by this drafting step.
-- ============================================================

create or replace function public.rollback_consolidation(
    p_user_id uuid,
    p_canonical_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_canonical_user uuid;
    v_loser_ids uuid[];
    v_snap_times_used integer;
    v_snap_last_used timestamptz;
    v_snap_effective numeric;
begin
    if auth.uid() is null or auth.uid() <> p_user_id then
        raise exception 'not authorized';
    end if;

    select user_id into v_canonical_user from memories where id = p_canonical_id;
    if v_canonical_user is distinct from p_user_id then
        raise exception 'not authorized';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, hashtext('consolidate')));

    -- Capture losers from edges BEFORE any delete.
    select array_agg(source_id) into v_loser_ids
    from memory_edges
    where target_id = p_canonical_id
      and relation = 'consolidated_into'
      and user_id = p_user_id;

    if v_loser_ids is null then
        return jsonb_build_object('ok', false, 'reason', 'no_consolidation_edges');
    end if;

    -- Read canonical pre-state snapshot from its consolidate event.
    select
        (payload->>'pre_times_used')::integer,
        (payload->>'pre_last_used')::timestamptz,
        (payload->>'pre_effective_score')::numeric
    into v_snap_times_used, v_snap_last_used, v_snap_effective
    from memory_events
    where user_id = p_user_id
      and memory_id = p_canonical_id
      and action = 'consolidate'
      and payload->>'role' = 'canonical'
    order by created_at desc
    limit 1;

    -- Restore losers to their pre_status (read from their consolidate events).
    -- Must run BEFORE deleting the consolidate events.
    update memories as m
    set status = (e.payload->>'pre_status')::memory_status,
        updated_at = now()
    from memory_events e
    where e.memory_id = m.id
      and e.user_id = p_user_id
      and e.action = 'consolidate'
      and e.memory_id = any(v_loser_ids);

    -- Restore canonical pre-state.
    update memories
    set times_used = coalesce(v_snap_times_used, times_used),
        last_used = v_snap_last_used,
        effective_score = v_snap_effective,
        updated_at = now()
    where id = p_canonical_id and user_id = p_user_id;

    -- Remove ONLY consolidate events (preserve corroborate events).
    delete from memory_events
    where user_id = p_user_id
      and action = 'consolidate'
      and (memory_id = p_canonical_id or memory_id = any(v_loser_ids));

    -- Remove consolidation edges.
    delete from memory_edges
    where target_id = p_canonical_id
      and relation = 'consolidated_into'
      and user_id = p_user_id;

    return jsonb_build_object('ok', true, 'restored', v_loser_ids);
end;
$$;