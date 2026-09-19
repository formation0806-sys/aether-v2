-- ============================================================
-- 0019_harden_rpc_auth.sql — Aether Memory V2 | Security Hardening
-- Add auth.uid() guards and user-scoped WHERE clauses to RPCs
-- that were publicly callable or allowed mass-write via NULL params.
-- ============================================================

-- ---------- find_near_duplicates: add p_user_id + auth guard ----------
create or replace function find_near_duplicates(
  p_user_id uuid,
  p_embedding vector(768),
  p_threshold float default 0.85
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

-- ---------- touch_memories: add p_user_id + user-scoped WHERE ----------
create or replace function touch_memories(
  p_user_id uuid,
  p_ids uuid[]
) returns void language sql security definer as $$
  update memories
    set times_used = times_used + 1,
        last_used  = now()
  where id = any(p_ids)
    and user_id = p_user_id;
$$;

-- ---------- forget_archived: add p_user_id + auth guard + user scope ----------
create or replace function forget_archived(
  p_user_id uuid,
  p_grace_days int default 90
) returns int language plpgsql security definer as $$
declare n int := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  update memories set status = 'deleted'
  where user_id = p_user_id
    and status = 'archived'
    and updated_at < now() - make_interval(days => p_grace_days)
    and memory_type not in ('identity','procedural');
  get diagnostics n = row_count;
  delete from memories where status = 'deleted'
    and user_id = p_user_id
    and updated_at < now() - make_interval(days => p_grace_days + 30);
  return n;
end $$;

-- ---------- apply_memory_decay: require p_user_id + auth guard ----------
create or replace function apply_memory_decay(p_user_id uuid)
returns int language plpgsql security definer as $$
declare n int := 0; half_life_days numeric; m record;
begin
  if auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  for m in
    select * from memories
    where user_id = p_user_id
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
