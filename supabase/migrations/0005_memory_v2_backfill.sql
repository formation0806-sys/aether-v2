-- ============================================================
-- 0005_memory_v2_backfill.sql
-- Aether Memory V2
-- Backfill existing memories into V2 columns
-- Compatible with current schema
-- ============================================================

update memories
set
    memory_type = 'semantic',
    status = 'active',

    summary = case
        when summary = '' then left(regexp_replace(content, '\s+', ' ', 'g'), 280)
        else summary
    end,

    importance_v2 = 0.50,
    confidence_v2 = 0.50,

    tags = case
        when cardinality(tags) = 0 then '{}'
        else tags
    end,

    source_v2 = 'import',

    last_scored = now(),
    effective_score = 0.50

where
    memory_type = 'semantic'
    and status = 'candidate'
    and source_v2 = 'extractor';

-- ------------------------------------------------------------
-- Record migration completion
-- ------------------------------------------------------------

create table if not exists migration_meta (
    name text primary key,
    applied_at timestamptz not null default now(),
    note text
);

insert into migration_meta (name, note)
values (
    '0005_memory_v2_backfill',
    'Backfilled existing memories into Memory V2'
)
on conflict (name) do nothing;