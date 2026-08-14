-- ============================================================
-- 0003_memory_v2_indexes.sql — Aether Memory V2 | Phase P1
-- Indexes for retrieval + lifecycle performance. Idempotent.
-- ============================================================

-- Vector index (HNSW for recall + live inserts; nn for older pgvector)
create index if not exists memories_embedding_hnsw_idx
  on memories using hnsw (embedding vector_cosine_ops)
  where status <> 'deleted';

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
