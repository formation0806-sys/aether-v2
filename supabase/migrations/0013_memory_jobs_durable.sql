-- 0013_memory_jobs_durable.sql
-- Phase 1: durable foundation for memory-maintenance jobs.
-- Adds: message_id FK, next_retry_at, per-(user,message) identity, status CHECK,
-- SELECT-only RLS, and five ownership-checked SECURITY DEFINER RPCs.
-- No attempt_limit column; max attempts is an application-level constant (Phase 2).

-- 1. Columns
alter table memory_jobs
  add column if not exists message_id uuid;

alter table memory_jobs
  drop constraint if exists memory_jobs_message_id_fkey;
alter table memory_jobs
  add constraint memory_jobs_message_id_fkey
  foreign key (message_id)
  references messages (id)
  on delete set null;

alter table memory_jobs
  add column if not exists next_retry_at timestamptz;

-- 2. Idempotent message-level job identity: one (user, message) => one job.
create unique index if not exists memory_jobs_user_message_uidx
  on memory_jobs (user_id, message_id)
  where message_id is not null;

-- 3. Legal job states (table is empty, so the constraint validates cleanly).
alter table memory_jobs
  drop constraint if exists memory_jobs_status_check;
alter table memory_jobs
  add constraint memory_jobs_status_check
  check (status in ('pending', 'processing', 'completed', 'failed'));

-- 4. Visibility only. All mutations go through the SECURITY DEFINER RPCs below.
--    No INSERT/UPDATE/DELETE policies are created for memory_jobs.
alter table memory_jobs enable row level security;
drop policy if exists memory_jobs_select on memory_jobs;
create policy memory_jobs_select
  on memory_jobs
  for select
  using (auth.uid() = user_id);

-- 5. RPC 1: atomic message + job enqueue (single transaction).
create or replace function create_message_and_job(p_user_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_message_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  if p_message is null or btrim(p_message) = '' then
    raise exception 'message must not be empty';
  end if;
  insert into messages (user_id, role, content)
    values (p_user_id, 'user', p_message)
    returning id into v_message_id;
  insert into memory_jobs (job_type, user_id, message_id, status, payload)
    values ('memory_maintenance', p_user_id, v_message_id, 'pending',
            jsonb_build_object('message', p_message))
    on conflict (user_id, message_id) where message_id is not null do nothing;
  return v_message_id;
end;
$$;

-- 6. RPC 2: atomic claim. attempts is incremented inside PostgreSQL so that
--    concurrent processors cannot double-claim a single job.
create or replace function claim_memory_jobs(p_user_id uuid, p_max int default 5)
returns setof memory_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
    return query
    update memory_jobs
      set status = 'processing',
          attempts = attempts + 1,
          started_at = now()
      where id in (
        select id from memory_jobs
        where user_id = p_user_id
          and status = 'pending'
          and (next_retry_at is null or next_retry_at <= now())
        order by created_at
        limit p_max
      )
      and status = 'pending'
      returning memory_jobs.*;
end;
$$;

-- 7. RPC 3: atomic complete. Only processing => completed.
create or replace function complete_memory_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  update memory_jobs
    set status = 'completed',
        finished_at = now()
    where id = p_job_id
      and user_id = auth.uid()
      and status = 'processing';
  return found;
end;
$$;

-- 8. RPC 4: atomic fail / retry / dead-letter. Only operates on processing jobs.
create or replace function fail_memory_job(p_job_id uuid, p_error text, p_dead_letter boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;
  if p_dead_letter then
    update memory_jobs
      set status = 'failed',
          last_error = p_error,
          finished_at = now()
      where id = p_job_id
        and user_id = auth.uid()
        and status = 'processing';
  else
    -- attempts was already incremented at claim time; this is the failed attempt.
    -- attempt 1 -> 60s, 2 -> 120s, 3 -> 240s, 4 -> 480s, cap 3600s.
    update memory_jobs
      set status = 'pending',
          last_error = p_error,
          next_retry_at = now()
            + least(pow(2, greatest(attempts - 1, 0)) * interval '60 second',
                    interval '3600 second')
      where id = p_job_id
        and user_id = auth.uid()
        and status = 'processing';
  end if;
end;
$$;

-- 9. RPC 5: stale processing-job reclaim. Returns actual row count.
create or replace function reclaim_stale_memory_jobs(p_user_id uuid, p_lease_seconds int default 300)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  update memory_jobs
    set status = 'pending',
        next_retry_at = null
    where user_id = p_user_id
      and status = 'processing'
      and started_at < now() - make_interval(secs => p_lease_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 10. Privileges: revoke PUBLIC default, grant only to authenticated. Never anon.
revoke all on function public.create_message_and_job(uuid, text) from public, anon;
grant execute on function public.create_message_and_job(uuid, text) to authenticated;

revoke all on function public.claim_memory_jobs(uuid, integer) from public, anon;
grant execute on function public.claim_memory_jobs(uuid, integer) to authenticated;

revoke all on function public.complete_memory_job(uuid) from public, anon;
grant execute on function public.complete_memory_job(uuid) to authenticated;

revoke all on function public.fail_memory_job(uuid, text, boolean) from public, anon;
grant execute on function public.fail_memory_job(uuid, text, boolean) to authenticated;

revoke all on function public.reclaim_stale_memory_jobs(uuid, integer) from public, anon;
grant execute on function public.reclaim_stale_memory_jobs(uuid, integer) to authenticated;
