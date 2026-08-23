-- ============================================================
-- 0015_consolidation_functions.sql
-- Aether Memory V2 | Phase 6-AN (part 2 of 2)
--
-- Defines the consolidation RPCs that reference the 'merged' enum
-- label added in 0014. Kept in a SEPARATE migration so the label
-- is already committed when these functions are created (avoids
-- SQLSTATE 55P04). Semantics are identical to the approved
-- Phase 6-AN contract; only the transaction boundary moved.
--
-- The five Aether fixture rows are intentionally NOT touched by
-- this migration (it only defines machinery).
-- ============================================================

-- 1. Exclude 'merged' from normal retrieval (signature unchanged).
create or replace function match_memories_v2(
    p_user_id uuid,
    p_query_embedding vector(768),
    p_match_threshold float default 0.75,
    p_match_count int default 10
)
returns table (
    id uuid,
    title text,
    content text,
    summary text,
    similarity float,
    memory_type memory_type,
    status memory_status,
    importance numeric,
    confidence numeric,
    effective_score numeric,
    times_used integer,
    last_used timestamptz
)
language sql
stable
as $$
select
    m.id,
    m.title,
    m.content,
    m.summary,
    1 - (m.embedding <=> p_query_embedding) as similarity,
    m.memory_type,
    m.status,
    m.importance_v2 as importance,
    m.confidence_v2 as confidence,
    m.effective_score,
    m.times_used,
    m.last_used
from memories m
where
    m.user_id = p_user_id
    and m.embedding is not null
    and (1 - (m.embedding <=> p_query_embedding)) >= p_match_threshold
    and m.status not in ('archived', 'deleted', 'merged')
order by m.embedding <=> p_query_embedding
limit p_match_count;
$$;

-- 2. Consolidation RPC (atomic, advisory-locked, idempotent).
create or replace function consolidate_memories(
    p_user_id uuid,
    p_keep uuid,
    p_merge uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_keep_user uuid;
    v_already_merged boolean;
    u uuid;
    v_keep memories%rowtype;
    v_max_last_used timestamptz;
    v_snapshot jsonb;
    v_cid uuid := gen_random_uuid();
    v_half_life numeric;
begin
    if auth.uid() is null or auth.uid() <> p_user_id then
        raise exception 'not authorized';
    end if;

    select user_id into v_keep_user from memories where id = p_keep;
    if v_keep_user is distinct from p_user_id then
        raise exception 'not authorized';
    end if;

    -- Prevent concurrent consolidation for the same user.
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 'consolidate'::text));

    -- Keep must not already be a consolidation target.
    select exists(
        select 1 from memory_edges
        where target_id = p_keep and relation = 'consolidated_into'
    ) into v_already_merged;
    if v_already_merged then
        return jsonb_build_object('ok', false, 'reason', 'keep_already_consolidated');
    end if;

    -- Validate each merge candidate.
    foreach u in array p_merge loop
        if u = p_keep then
            return jsonb_build_object('ok', false, 'reason', 'merge_equals_keep');
        end if;
        if not exists(select 1 from memories where id = u and user_id = p_user_id) then
            return jsonb_build_object('ok', false, 'reason', 'merge_not_owned', 'id', u);
        end if;
        if exists(
            select 1 from memory_edges
            where source_id = u and relation = 'consolidated_into'
        ) then
            return jsonb_build_object('ok', false, 'reason', 'merge_already_merged', 'id', u);
        end if;
    end loop;

    select * into v_keep from memories where id = p_keep;

    -- Max last_used across the whole pool.
    select max(last_used) into v_max_last_used
    from memories where id = any(array_append(p_merge, p_keep));

    -- Snapshot canonical pre-state for rollback.
    v_snapshot := jsonb_build_object(
        'pre_times_used', v_keep.times_used,
        'pre_last_used', v_keep.last_used,
        'pre_effective_score', v_keep.effective_score
    );

    -- Half-life for the canonical's memory type.
    v_half_life := case v_keep.memory_type
        when 'identity' then 3650.0
        when 'procedural' then 365.0
        when 'reflection' then 90.0
        when 'project' then 180.0
        when 'episodic' then 14.0
        when 'semantic' then 180.0
        when 'conversation' then 30.0
        when 'working' then 1.0
        else 180.0
    end;

    -- Update canonical: last_used = max(pool), recompute effective_score
    -- (0.7*importance + 0.2*recency); other fields unchanged.
    update memories
    set last_used = coalesce(v_max_last_used, last_used),
        effective_score = round(
            (
                coalesce(importance_v2, 0.5) * 0.7
                + case
                    when coalesce(v_max_last_used, last_used) is null then 0.2
                    else 0.2 * exp(
                        -ln(2.0) * extract(epoch from (now() - coalesce(v_max_last_used, last_used))) / 86400.0
                        / v_half_life
                    )
                end
            )::numeric,
            3
        ),
        updated_at = now()
    where id = p_keep;

    -- For each loser: edge + event snapshot + status flip.
    foreach u in array p_merge loop
        insert into memory_edges (user_id, source_id, target_id, relation)
        values (p_user_id, u, p_keep, 'consolidated_into');

        insert into memory_events (user_id, memory_id, action, consolidation_id, payload)
        select
            p_user_id,
            u,
            'consolidate',
            v_cid,
            jsonb_build_object(
                'canonical_id', p_keep,
                'observation_id', m.observation_id,
                'source_v2', m.source_v2,
                'source_ref', m.source_ref,
                'title', m.title,
                'content', m.content,
                'tags', m.tags,
                'metadata', m.metadata,
                'times_used', m.times_used,
                'last_used', m.last_used,
                'confidence_v2', m.confidence_v2,
                'importance_v2', m.importance_v2,
                'effective_score', m.effective_score,
                'pre_status', m.status
            )
        from memories m where m.id = u;

        update memories set status = 'merged', updated_at = now() where id = u;
    end loop;

    -- Canonical consolidation event (audit of the whole batch).
    insert into memory_events (user_id, memory_id, action, consolidation_id, payload)
    values (
        p_user_id,
        p_keep,
        'consolidate',
        v_cid,
        jsonb_build_object(
            'role', 'canonical',
            'merged_ids', p_merge,
            'pre_times_used', v_snapshot->>'pre_times_used',
            'pre_last_used', v_snapshot->>'pre_last_used',
            'pre_effective_score', v_snapshot->>'pre_effective_score'
        )
    );

    return jsonb_build_object('ok', true, 'canonical_id', p_keep, 'merged', p_merge, 'consolidation_id', v_cid);
end;
$$;

-- 3. Rollback RPC (reverse a consolidation batch).
create or replace function rollback_consolidation(
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

    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 'consolidate'::text));

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

-- 4. Privileges.
revoke all on function public.consolidate_memories(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.consolidate_memories(uuid, uuid, uuid[]) to authenticated;

revoke all on function public.rollback_consolidation(uuid, uuid) from public, anon;
grant execute on function public.rollback_consolidation(uuid, uuid) to authenticated;
