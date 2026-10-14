-- ============================================================
-- 0003_memory_v2_indexes.sql — Aether Memory V2 | Phase P1
-- Indexes for retrieval + lifecycle performance. Idempotent.
-- ============================================================

-- Vector index (HNSW when the access method exists; ivfflat fallback; else skip).
-- CREATE INDEX IF NOT EXISTS does not tolerate an unknown access method, so
-- probe pg_am first. Fresh/local Postgres without pgvector HNSW support must
-- not fail this migration.
do $$
begin
  if exists (select 1 from pg_am where amname = 'hnsw') then
    create index if not exists memories_embedding_hnsw_idx
      on memories using hnsw (embedding vector_cosine_ops)
      where status <> 'deleted';
  elsif exists (select 1 from pg_am where amname = 'ivfflat') then
    create index if not exists memories_embedding_ivfflat_idx
      on memories using ivfflat (embedding vector_cosine_ops)
      where status <> 'deleted';
  else
    raise notice 'no vector index access method available; skipping embedding index';
  end if;
end $$;

create index if not exists memories_user_type_idx   on memories(user_id, memory_type);
create index if not exists memories_user_status_idx on memories(user_id, status);
create index if not exists memories_tags_idx        on memories using gin (tags);
create index if not exists memories_tsv_idx
  on memories using gin (to_tsvector('english', title || ' ' || content || ' ' || summary));
create index if not exists memories_effective_score_idx on memories(user_id, effective_score desc);
create index if not exists memories_project_idx     on memories(project_id) where project_id is not null;
create index if not exists memory_events_user_idx   on memory_events(user_id, created_at desc);
create index if not exists memory_edges_user_idx    on memory_edges(user_id, source_id);
create index if not exists memory_jobs_status_idx   on memory_jobs(status, created_at);
