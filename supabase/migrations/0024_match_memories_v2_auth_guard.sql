-- ============================================================
-- 0024_match_memories_v2_auth_guard.sql
-- M7-A49: defense-in-depth ownership guard for the LIVE four-argument
--         retrieval RPC  public.match_memories_v2(uuid, vector,
--         double precision, integer).
--
-- STATUS (M7-A49): APPLIED AND RECORDED on the LOCAL development database
-- only (docker supabase_db_aether-v2), recorded in its local migration
-- history as version 0024 (match_memories_v2_auth_guard). Remote
-- application remains UNAPPROVED and owner-gated; nothing here implies or
-- authorizes applying this file to any remote project.
--
-- WHY (audit M7-A47 → plan M7-A48): this is the hot-path retrieval RPC.
-- It was SECURITY INVOKER with NO explicit auth.uid() guard and an
-- unpinned search_path. Today it is safe only because (a) it runs as the
-- caller and the `memories` RLS SELECT policy (auth.uid() = user_id) already
-- restricts rows, and (b) every live caller passes p_user_id = its own
-- auth.uid(). This migration adds an explicit fail-closed guard + pins
-- search_path so the invariant does not depend on RLS policy staying intact
-- and survives any future flip to SECURITY DEFINER.
--
-- DELTA vs the live definition (nothing else changes):
--   * LANGUAGE sql        -> LANGUAGE plpgsql  (required to RAISE)
--   * add  set search_path = public           (was unpinned)
--   * add  ownership guard: reject null p_user_id, null auth.uid(),
--       and auth.uid()<>p_user_id (fails closed)
-- PRESERVED (byte-for-byte from the live pg_get_functiondef):
--   * exact signature: (p_user_id uuid, p_query_embedding vector,
--       p_match_threshold double precision DEFAULT 0.75,
--       p_match_count integer DEFAULT 10)
--   * RETURNS TABLE columns/types unchanged
--   * STABLE, SECURITY INVOKER (default; not made DEFINER)
--   * filters: user_id = p_user_id, embedding is not null,
--       (1-(embedding<=>q)) >= threshold, status not in (archived,deleted,merged)
--   * similarity calc, ORDER BY embedding <=> q, LIMIT p_match_count
--   * existing ACL {postgres,authenticated} — NO grants/revokes added
-- The seven-argument overload match_memories_v2(vector, uuid, integer, ...)
-- is intentionally untouched by this migration.
-- ============================================================

create or replace function match_memories_v2(
    p_user_id uuid,
    p_query_embedding vector,
    p_match_threshold double precision default 0.75,
    p_match_count int default 10
)
returns table (
    id uuid,
    title text,
    content text,
    summary text,
    tags text[],
    similarity double precision,
    memory_type memory_type,
    status memory_status,
    importance numeric,
    confidence numeric,
    effective_score numeric,
    times_used integer,
    last_used timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
    -- Ownership guard (mirrors 0015/0016/0018/0019/0022). Fails closed on
    -- a null p_user_id, a missing identity, or a p_user_id that is not the
    -- caller's own id. (The explicit null check is required: `auth.uid() <>
    -- NULL` is NULL, not TRUE, so without it a null p_user_id would slip
    -- through to a 0-row result instead of raising.)
    if p_user_id is null or auth.uid() is null or auth.uid() <> p_user_id then
        raise exception 'not authorized';
    end if;

    -- Body preserved verbatim from the live SQL definition.
    return query
    select
        m.id,
        m.title,
        m.content,
        m.summary,
        m.tags,
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
end $$;
