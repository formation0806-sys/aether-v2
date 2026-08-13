-- ============================================================
-- 0005_memory_v2_backfill.sql — Aether Memory V2 | Phase P2
-- Idempotent one-off backfill of existing `memories` rows into
-- the V2 columns added in 0002. Never touches new rows once the
-- writer starts stamping these fields.
-- ============================================================

-- Backfill only rows that have not yet been classified (they carry
-- the default 'semantic'/'candidate' from the add-column migration
-- or had never been classified). We skip rows that already carry a
-- non-default source so we never overwrite writer output.
update memories
set memory_type = 'semantic',
    status       = 'active',
    summary      = case
                     when summary = '' then left(regexp_replace(content, '\s+', ' ', 'g'), 280)
                     else summary
                   end,
    importance   = 0.5,
    confidence   = 0.5,
    tags         = case
                     when cardinality(tags) = 0 then '{}'
                     else tags
                   end,
    source       = 'import',
    last_scored  = now(),
    effective_score = 0.5
where memory_type = 'semantic'
  and status = 'candidate'
  and source = 'extractor';

-- Indexes are already created by 0003; record completion marker.
create table if not exists migration_meta (
  name        text primary key,
  applied_at  timestamptz not null default now(),
  note        text
);

insert into migration_meta (name, note)
values ('0005_memory_v2_backfill', 'Memories backfilled to V2 columns')
on conflict (name) do nothing;