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
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, hashtext('consolidate')));

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
