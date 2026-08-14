-- ============================================================
-- 0004_memory_v2_rpcs.sql — Aether Memory V2 | Phase P1
-- Stored procedures for retrieval, dedupe, decay, forgetting,
-- merging, triggers, and RLS. Idempotent via CREATE OR REPLACE.
-- ============================================================

-- ---------- Core hybrid vector retrieval ----------
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
) language plpgsql security definer as $$
begin
  if auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  return query
  select
    m.id, m.title, m.content, m.summary, m.tags,
    m.memory_type::text, m.importance, m.confidence,
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

-- ---------- Near-duplicate detection for the deduper ----------
create or replace function find_near_duplicates(
  p_user_id uuid, p_embedding vector(768), p_threshold float default 0.85
) returns table (id uuid, title text, similarity float, memory_type text, status text)
language sql security definer stable as $$
  select m.id, m.title, 1 - (m.embedding <=> p_embedding) as similarity,
         m.memory_type::text, m.status::text
  from memories m
  where m.user_id = p_user_id
    and m.embedding is not null
    and m.status::text in ('active','fading')
    and 1 - (m.embedding <=> p_embedding) >= p_threshold
  order by similarity desc
  limit 50;
$$;
  -- ---------- Decay sweep: recompute effective_score ----------
create or replace function apply_memory_decay(p_user_id uuid default null)
returns int language plpgsql security definer as $$
declare n int := 0; half_life_days numeric;
begin
  for m in
    select * from memories
    where (p_user_id is null or user_id = p_user_id)
      and status in ('active','fading')
      and memory_type <> 'identity'
  loop
    half_life_days := case m.memory_type
      when 'episodic'   then 14
      when 'semantic'   then 180
      when 'procedural' then 365
      when 'project'    then 180
      when 'reflection' then 90
      when 'conversation' then 30
      when 'working'    then 1
      else 180 end;
    update memories
      set effective_score = round(
            (m.importance::float * 0.7
           + (case when m.last_used is null then 0.2
                   else 0.2 * exp(-ln(2) * extract(epoch from (now()-m.last_used))/86400 / half_life_days) end)
            )::numeric, 3),
          last_scored = now()
      where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Forgetting: soft-delete then hard-purge ----------
create or replace function forget_archived(p_grace_days int default 90)
returns int language plpgsql security definer as $$
declare n int := 0;
begin
  update memories set status = 'deleted'
  where status = 'archived'
    and updated_at < now() - make_interval(days => p_grace_days)
    and memory_type not in ('identity','procedural');
  get diagnostics n = row_count;
  delete from memories where status = 'deleted'
    and updated_at < now() - make_interval(days => p_grace_days + 30);
  return n;
end $$;

-- ---------- Merge keep into mergees (dup + consolidation) ----------
create or replace function merge_memories(p_keep uuid, p_merge uuid[])
returns void language plpgsql security definer as $$
declare u uuid; keep_user uuid;
begin
  select user_id into keep_user from memories where id = p_keep;
  if auth.uid() <> keep_user then raise exception 'not authorized'; end if;

  foreach u in array p_merge loop
    insert into memory_edges(user_id, source_id, target_id, relation)
    values (keep_user, u, p_keep, 'merges_into');
    update memories set
      times_used = memories.times_used +
        (select m.times_used from memories m where m.id = u),
      tags = (select array(select distinct unnest(memories.tags || (select m.tags from memories m where m.id = u)))),
      updated_at = now()
    where id = p_keep;
    update memories set status = 'deleted' where id = u;
    insert into memory_events(user_id, memory_id, action, payload)
    values (keep_user, p_keep, 'merged', jsonb_build_object('from', u));
  end loop;
end $$;

-- ---------- Batched retrieval side-effects ----------
create or replace function touch_memories(p_ids uuid[])
returns void language plpgsql security definer as $$
begin
  update memories
    set times_used = times_used + 1,
        last_used  = now()
  where id = any(p_ids);
end $$;

-- ---------- updated_at trigger ----------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists memories_updated_at on memories;
create trigger memories_updated_at before update on memories
  for each row execute function set_updated_at();

drop trigger if exists memory_clusters_updated_at on memory_clusters;
create trigger memory_clusters_updated_at before update on memory_clusters
  for each row execute function set_updated_at();

-- ---------- RLS ----------
alter table memories enable row level security;
alter table memory_clusters enable row level security;
alter table memory_edges enable row level security;
alter table memory_events enable row level security;

alter table memory_jobs enable row level security;

drop policy if exists memories_select on memories;
create policy memories_select on memories for select using (auth.uid() = user_id);
drop policy if exists memories_insert on memories;
create policy memories_insert on memories for insert with check (auth.uid() = user_id);
drop policy if exists memories_update on memories;
create policy memories_update on memories for update using (auth.uid() = user_id);
drop policy if exists memories_delete on memories;
create policy memories_delete on memories for delete using (auth.uid() = user_id);