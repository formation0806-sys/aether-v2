-- ============================================================
-- 0009_memory_v2_status_filter.sql
-- Aether Memory V2
--
-- Prevent archived/deleted memories from entering normal
-- retrieval while preserving candidate/active/fading retrieval.
--
-- Existing function signature preserved.
-- Existing callers require no changes.
-- ============================================================

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
    and m.status not in ('archived', 'deleted')
order by m.embedding <=> p_query_embedding
limit p_match_count;
$$;