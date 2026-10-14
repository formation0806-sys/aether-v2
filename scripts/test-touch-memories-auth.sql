-- ============================================================
-- scripts/test-touch-memories-auth.sql
-- M7-A45: focused authorization tests for the 0022 guard on
--         public.touch_memories(uuid, uuid[]).
--
-- Run (local docker only):
--   Get-Content -Raw scripts/test-touch-memories-auth.sql |
--     docker exec -i supabase_db_aether-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- The script owns its own transaction: all fixtures, the role and
-- the jwt-claim settings are SET LOCAL and everything is rolled
-- back at the end, so nothing persists. When piped after the 0022
-- migration inside an outer BEGIN (the dry run), the inner BEGIN
-- emits a benign "already a transaction in progress" WARNING and
-- the single ROLLBACK discards migration + fixtures together.
--
-- Assertions RAISE on failure (they are never merely printed).
-- Expected rejections are caught narrowly (WHEN raise_exception
-- AND sqlerrm = 'not authorized'); anything else — including an
-- unexpected P0001 — is re-raised, and ON_ERROR_STOP aborts.
-- ============================================================

begin;

-- ---------- fixtures (postgres; rolled back at the end) ----------
-- auth.users: only `id` is NOT NULL without a default.
-- memories:   user_id / title / content are the only required inputs.
insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
on conflict (id) do nothing;

insert into memories (id, user_id, title, content, times_used, last_used) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A memory 1', 'fixture', 0, null),
  ('a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A memory 2', 'fixture', 0, null),
  ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B memory 1', 'fixture', 0, null)
on conflict (id) do nothing;

-- ---------- 1) owner updates their own memories ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';

do $mt9$
begin
  perform public.touch_memories(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid,
          'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'::uuid]);
end $mt9$;

-- ---------- 2) different authenticated user is rejected ----------
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';

do $mt9$
begin
  begin
    perform public.touch_memories(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      array['a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid]);
    raise exception 'TEST FAILED: cross-user call unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
end $mt9$;

-- ---------- 3) missing identity is rejected ----------
set local request.jwt.claims = '';

do $mt9$
begin
  begin
    perform public.touch_memories(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      array['a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid]);
    raise exception 'TEST FAILED: missing-identity call unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
end $mt9$;


-- ---------- 4) null p_user_id is rejected ----------
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';

do $mt9$
begin
  begin
    perform public.touch_memories(null::uuid,
      array['a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid]);
    raise exception 'TEST FAILED: null p_user_id call unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
end $mt9$;

-- ---------- 6a) empty id array: authorized no-op ----------
do $mt9$
begin
  perform public.touch_memories(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array[]::uuid[]);
end $mt9$;

-- ---------- 6b) nonexistent ids: authorized no-op ----------
do $mt9$
begin
  perform public.touch_memories(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid]);
end $mt9$;

-- ---------- 5+6c) mixed own/foreign ids: only own rows touched ----------
do $mt9$
begin
  perform public.touch_memories(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array['a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'::uuid,
          'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'::uuid]);
end $mt9$;

-- ---------- data assertions (still inside the txn) ----------
-- Back to postgres for the catalog/ACL checks.
reset role;
reset request.jwt.claims;

do $mt9$
declare
  a1_times int; a1_used timestamptz;
  a2_times int; a2_used timestamptz;
  b1_times int; b1_used timestamptz;
begin
  select times_used, last_used into a1_times, a1_used from memories
    where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  select times_used, last_used into a2_times, a2_used from memories
    where id = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
  select times_used, last_used into b1_times, b1_used from memories
    where id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';

  -- owner call (1) + mixed call (5c) each incremented a1 exactly once
  if a1_times is distinct from 2 or a1_used is null then
    raise exception 'TEST FAILED: a1 expected times_used=2, last_used set; got %, %', a1_times, a1_used;
  end if;
  -- a2 touched only by the owner call
  if a2_times is distinct from 1 or a2_used is null then
    raise exception 'TEST FAILED: a2 expected times_used=1, last_used set; got %, %', a2_times, a2_used;
  end if;
  -- every rejected/foreign path left B's row completely untouched
  if b1_times is distinct from 0 or b1_used is not null then
    raise exception 'TEST FAILED: b1 must stay times_used=0, last_used null; got %, %', b1_times, b1_used;
  end if;
  raise notice 'PASS data assertions: owner=ok, cross-user=blocked, foreign rows untouched';
end $mt9$;


-- ---------- 7) EXECUTE privilege matrix ----------
do $mt9$
begin
  if has_function_privilege('public',
       'public.touch_memories(uuid, uuid[])', 'execute') then
    raise exception 'TEST FAILED: PUBLIC must not execute touch_memories(uuid, uuid[])';
  end if;
  if has_function_privilege('anon',
       'public.touch_memories(uuid, uuid[])', 'execute') then
    raise exception 'TEST FAILED: anon must not execute touch_memories(uuid, uuid[])';
  end if;
  if not has_function_privilege('authenticated',
       'public.touch_memories(uuid, uuid[])', 'execute') then
    raise exception 'TEST FAILED: authenticated must execute touch_memories(uuid, uuid[])';
  end if;
  if has_function_privilege('service_role',
       'public.touch_memories(uuid, uuid[])', 'execute') then
    raise exception 'TEST FAILED: service_role must not execute touch_memories(uuid, uuid[])';
  end if;
  if not has_function_privilege('postgres',
       'public.touch_memories(uuid, uuid[])', 'execute') then
    raise exception 'TEST FAILED: postgres must execute touch_memories(uuid, uuid[])';
  end if;

  -- legacy 1-arg overload stays revoked for API roles (0021)
  if has_function_privilege('public',
       'public.touch_memories(uuid[])', 'execute')
     or has_function_privilege('anon',
       'public.touch_memories(uuid[])', 'execute')
     or has_function_privilege('authenticated',
       'public.touch_memories(uuid[])', 'execute')
     or has_function_privilege('service_role',
       'public.touch_memories(uuid[])', 'execute') then
    raise exception 'TEST FAILED: legacy touch_memories(uuid[]) must stay revoked from API roles';
  end if;
  raise notice 'PASS ACL matrix: 2-arg posture preserved; 1-arg still revoked';
end $mt9$;

-- ---------- 8) function definition: guard + pinned search_path ----------
do $mt9$
declare
  p record;
  n_overloads int;
begin
  select count(*) into n_overloads
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public' and proc.proname = 'touch_memories';
  if n_overloads <> 2 then
    raise exception 'TEST FAILED: expected exactly 2 touch_memories overloads, got %', n_overloads;
  end if;

  select l.lanname as lang, proc.prosecdef, proc.proconfig, proc.prosrc,
         proc.prorettype = 'void'::regtype as returns_void
    into p
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  join pg_catalog.pg_language l on l.oid = proc.prolang
  where ns.nspname = 'public'
    and proc.proname = 'touch_memories'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'p_user_id uuid, p_ids uuid[]';

  if not found then
    raise exception 'TEST FAILED: touch_memories(uuid, uuid[]) not found';
  end if;
  if p.lang <> 'plpgsql' then
    raise exception 'TEST FAILED: expected language plpgsql, got %', p.lang;
  end if;
  if not p.prosecdef then
    raise exception 'TEST FAILED: SECURITY DEFINER must be preserved';
  end if;
  if not p.returns_void then
    raise exception 'TEST FAILED: RETURNS void must be preserved';
  end if;
  if p.proconfig is null
     or not (p.proconfig @> array['search_path=public']::text[]) then
    raise exception 'TEST FAILED: search_path must be pinned to public; proconfig=%', p.proconfig;
  end if;
  if position('auth.uid()' in p.prosrc) = 0
     or position('p_user_id is null' in p.prosrc) = 0 then
    raise exception 'TEST FAILED: ownership guard missing from prosrc';
  end if;
  raise notice 'PASS definition: plpgsql + security definer + void + search_path=public + guard present';
end $mt9$;

rollback;

-- Final line for logs (no state change).
select 'TOUCH_MEMORIES_AUTH_TESTS: ALL PASSED' as result;
