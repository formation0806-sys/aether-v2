-- ============================================================
-- 0002_memory_v2_tables.sql — Aether Memory V2 | Phase P1
-- Additive V2 columns on `memories` + new auxiliary tables.
-- All additive / idempotent — safe against a live DB.
-- ============================================================

-- ---------- V2 columns on memories ----------
alter table memories add column if not exists memory_type memory_type not null default 'semantic';
alter table memories add column if not exists status       memory_status not null default 'candidate';
alter table memories add column if not exists summary      text not null default '';
alter table memories add column if not exists tags         text[] not null default '{}';
alter table memories add column if not exists importance   numeric(3,2) not null default 0.5;
alter table memories add column if not exists confidence   numeric(3,2) not null default 0.5;
alter table memories add column if not exists source       memory_source not null default 'extractor';
alter table memories add column if not exists source_ref   text;
alter table memories add column if not exists project_id   uuid references projects(id) on delete set null;
alter table memories add column if not exists cluster_id   uuid;
alter table memories add column if not exists metadata     jsonb not null default '{}';
alter table memories add column if not exists last_scored  timestamptz not null default now();
alter table memories add column if not exists effective_score numeric(4,3) not null default 0.5;

-- ---------- memory_clusters ----------
create table if not exists memory_clusters (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  centroid       vector(768) not null,
  label          text,
  member_count   int not null default 0,
  avg_importance numeric(3,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- cluster_id FK (added after cluster table exists to satisfy dependency)
alter table memories
  drop constraint if exists memories_cluster_id_fkey;
alter table memories
  add constraint memories_cluster_id_fkey
  foreign key (cluster_id) references memory_clusters(id) on delete set null;

-- ---------- memory_edges ----------
create table if not exists memory_edges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  source_id  uuid not null references memories(id) on delete cascade,
  target_id  uuid not null references memories(id) on delete cascade,
  relation   text not null
             check (relation in ('merges_into','supersedes','consolidated_into',
                                 'derives_from','contradicts','related_to','source_of')),
  created_at timestamptz not null default now(),
  check (source_id <> target_id)
);

-- ---------- memory_events ----------
create table if not exists memory_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  memory_id  uuid references memories(id) on delete set null,
  action     text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- ---------- conversation layer support ----------
alter table messages add column if not exists session_id uuid;
alter table messages add column if not exists token_count int not null default 0;

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  summary    text not null default '',
  turn_count int not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- async job queue ----------
create table if not exists memory_jobs (
  id          uuid primary key default gen_random_uuid(),
  job_type    text not null,
  user_id     uuid null,
  status      text not null default 'pending',
  payload     jsonb,
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
