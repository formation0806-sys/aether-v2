-- ============================================================
-- 0000_baseline.sql  —  Aether Memory V2 | Phase P0
-- Purpose: bring an already-existing cloud schema under version
--          control. Idempotent so it is safe against a live DB.
-- Mirrors the legacy schema as reconstructed from the codebase.
-- ============================================================

create extension if not exists vector;

-- ---------- legacy: memories ----------
create table if not exists memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'system',
  title       text not null,
  content     text not null,
  embedding   vector(768),
  times_used  int not null default 0,
  last_used   timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- legacy: match_memories RPC ----------
create or replace function match_memories(
  query_embedding vector(768),
  match_user uuid,
  match_count int default 8
) returns table (
  id uuid, user_id uuid, role text, title text, content text,
  similarity float, times_used int, last_used timestamptz, created_at timestamptz
) language plpgsql security definer as $$
begin
  return query
  select
    m.id, m.user_id, m.role, m.title, m.content,
    1 - (m.embedding <=> query_embedding) as similarity,
    m.times_used, m.last_used, m.created_at
  from memories m
  where m.user_id = match_user
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count;
end $$;

-- ---------- legacy: profiles ----------
create table if not exists profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  full_name        text,
  name             text,
  avatar_url       text,
  profession       text,
  age              int,
  favorite_language text,
  dog_name         text,
  updated_at       timestamptz default now()
);

-- ---------- legacy: messages (conversation layer) ----------
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null,
  content    text not null,
  created_at timestamptz not null default now()
);

-- ---------- legacy: knowledge ----------
create table if not exists knowledge (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  content    text not null,
  category   text not null default 'general',
  created_at timestamptz not null default now()
);

-- ---------- legacy: planner ----------
create table if not exists goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text
);

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  goal_id     uuid references goals(id) on delete set null
);

create table if not exists milestones (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title      text not null
);

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  milestone_id  uuid references milestones(id) on delete set null,
  title         text not null,
  description   text,
  priority      text not null default 'medium',
  status        text not null default 'todo',
  deadline      timestamptz,
  next_action   text,
  created_at    timestamptz not null default now()
);
