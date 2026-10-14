-- ============================================================
-- 0023_harden_remaining_rpcs.sql
-- Aether Memory V2 | M7-A46 (implements the two findings from the
-- post-M7-A45 read-only RPC security audit)
-- ============================================================
-- Two targeted repairs; NOTHING else in this file.
--
-- 1) forget_archived(uuid, integer) — privilege repair ONLY.
--    Verified defect: its proacl is NULL, i.e. the PostgreSQL
--    default (EXECUTE to PUBLIC), so anon/unauthenticated callers
--    can invoke this SECURITY DEFINER function. The body already
--    carries the 0019 auth.uid() guard (fail-closed), so this is
--    attack surface, not an exploit; the posture below matches
--    0018/0021 exactly (revoke public+anon, grant authenticated).
--    No application caller exists (the maintenance path uses
--    purge_archived; lib/core/pipeline.ts:541). The body and the
--    signature are NOT touched. The legacy forget_archived(integer)
--    overload stays revoked (0021) and is NOT touched.
--
-- 2) match_memories_v2(7-arg) — pin search_path ONLY.
--    Verified defect: SECURITY DEFINER with unpinned search_path
--    (the one remaining unpinned definer RPC after 0018/0022).
--    Body, signature, argument names, defaults, RETURNS TABLE,
--    language plpgsql and SECURITY DEFINER are preserved
--    BYTE-FOR-BYTE from the live catalog (md5-verified during
--    M7-A46 validation); the ONLY delta is the added
--    `set search_path = public` clause. The existing ACL
--    ({postgres, authenticated}) is preserved by CREATE OR REPLACE
--    (same language => same OID). The body already carries the
--    auth.uid() guard (0004). No lib/app caller uses the 7-arg
--    overload; the live retrieval path uses the 4-arg overload,
--    which is NOT touched by this file.
--
-- LOCAL-ONLY: intended for the LOCAL development database
-- (docker supabase_db_aether-v2). Remote application, promotion,
-- and approval remain fully owner-gated; nothing here implies or
-- authorizes applying this file to any remote project.
-- ============================================================

-- ---------- 1) forget_archived(uuid, integer): least-privilege ACL ----------
revoke execute on function public.forget_archived(uuid, int) from public, anon, service_role;
grant execute on function public.forget_archived(uuid, int) to authenticated;

-- ---------- 2) match_memories_v2 (7-arg): pin search_path ----------
create or replace function match_memories_v2(
  query_embedding vector(768),
  p_user_id        uuid,
  p_match_count    int default 30,
  p_min_similarity float default 0.65,
  p_types          text[] default null,
  p_statuses       text[] default array['active'],
  p_project_id     uuid default null
) returns table (
  id uuid, title text, content text, summary text, tags text[],
  memory_type text, importance numeric, confidence numeric,
  similarity float, effective_score numeric, times_used int, last_used timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  return query
  select
    m.id, m.title, m.content, m.summary, m.tags,
    m.memory_type::text, m.importance_v2, m.confidence_v2,
    1 - (m.embedding <=> query_embedding) as similarity,
    m.effective_score, m.times_used, m.last_used
  from memories m
  where m.user_id = p_user_id
    and m.embedding is not null
    and m.status::text = any(p_statuses)
    and (p_types is null or m.memory_type::text = any(p_types))
    and (p_project_id is null or m.project_id = p_project_id)
    and (1 - (m.embedding <=> query_embedding)) >= p_min_similarity
  order by similarity desc
  limit p_match_count;
end $$;
-- END OF 0023.
