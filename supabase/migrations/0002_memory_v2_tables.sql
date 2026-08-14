-- ============================================================
-- 0002_memory_v2_tables.sql
-- Compatible with existing Aether production database
-- ============================================================

-- =========================
-- Upgrade existing memories
-- =========================

alter table memories
add column if not exists memory_type memory_type not null default 'semantic';

alter table memories
add column if not exists status memory_status not null default 'candidate';

alter table memories
add column if not exists summary text not null default '';

alter table memories
add column if not exists tags text[] not null default '{}';

alter table memories
add column if not exists importance_v2 numeric(3,2) not null default 0.5;

alter table memories
add column if not exists confidence_v2 numeric(3,2) not null default 0.5;

alter table memories
add column if not exists source_v2 memory_source not null default 'extractor';

alter table memories
add column if not exists source_ref text;

alter table memories
add column if not exists metadata jsonb not null default '{}';

alter table memories
add column if not exists last_scored timestamptz default now();

alter table memories
add column if not exists effective_score numeric(4,3) default 0.5;

alter table memories
add column if not exists cluster_id uuid;

alter table memories
add column if not exists project_id uuid;

-- =========================
-- Memory Clusters
-- =========================

create table if not exists memory_clusters (

    id uuid primary key default gen_random_uuid(),

    user_id uuid not null references auth.users(id) on delete cascade,

    centroid vector(768),

    label text,

    member_count int default 0,

    avg_importance numeric(3,2) default 0,

    created_at timestamptz default now(),

    updated_at timestamptz default now()

);

alter table memories
drop constraint if exists memories_cluster_id_fkey;

alter table memories
add constraint memories_cluster_id_fkey
foreign key (cluster_id)
references memory_clusters(id)
on delete set null;

-- =========================
-- Memory Edges
-- =========================

create table if not exists memory_edges (

    id uuid primary key default gen_random_uuid(),

    user_id uuid references auth.users(id) on delete cascade,

    source_id uuid references memories(id) on delete cascade,

    target_id uuid references memories(id) on delete cascade,

    relation text,

    created_at timestamptz default now()

);

-- =========================
-- Memory Events
-- =========================

create table if not exists memory_events (

    id bigint generated always as identity primary key,

    user_id uuid references auth.users(id),

    memory_id uuid references memories(id),

    action text,

    payload jsonb,

    created_at timestamptz default now()

);

-- =========================
-- Conversation upgrades
-- =========================

alter table messages
add column if not exists session_id uuid;

alter table messages
add column if not exists token_count integer default 0;

-- =========================
-- Background jobs
-- =========================

create table if not exists memory_jobs (

    id uuid primary key default gen_random_uuid(),

    job_type text,

    user_id uuid,

    status text default 'pending',

    payload jsonb,

    attempts integer default 0,

    last_error text,

    created_at timestamptz default now(),

    started_at timestamptz,

    finished_at timestamptz

);