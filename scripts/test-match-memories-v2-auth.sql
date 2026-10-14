-- ============================================================
-- scripts/test-match-memories-v2-auth.sql
-- M7-A49: focused authorization + integrity tests for the 0024 guard on
--         public.match_memories_v2(uuid, vector, double precision, integer).
--
-- Run (local docker only):
--   Get-Content -Raw scripts/test-match-memories-v2-auth.sql |
--     docker exec -i supabase_db_aether-v2 psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- The script owns its own transaction: all fixtures, the role and the
-- jwt-claim settings are SET LOCAL and everything is rolled back at the
-- end, so nothing persists. When piped after the 0024 migration inside an
-- outer BEGIN (the dry run), the inner BEGIN emits a benign "already a
-- transaction in progress" WARNING and the single ROLLBACK discards
-- migration + fixtures together.
--
-- Assertions RAISE on failure (they are never merely printed). Expected
-- rejections are caught narrowly (WHEN raise_exception AND
-- sqlerrm = 'not authorized'); anything else — including an unexpected
-- P0001 — is re-raised, and ON_ERROR_STOP aborts.
-- ============================================================

begin;

-- ---------- fixtures (postgres; rolled back at the end) ----------
-- auth.users: only `id` is NOT NULL without a default.
-- memories:   user_id / title / content required; embedding is vector(768).
insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
on conflict (id) do nothing;

-- Build a 768-dim "ones" vector (cosine sim of ones-vs-ones = 1.0).
-- A's rows get a ones embedding (matchable); B's row is identical content
-- but belongs to a different user and must never be returned to A.
insert into memories (id, user_id, title, content, status, embedding) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A memory 1', 'fixture', 'active',
   (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768))),
  ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B memory 1', 'fixture', 'active',
   (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768)))
on conflict (id) do nothing;

-- ---------- 1) owner retrieves their own memories (guard admits) ----------
-- NOTE (local-DB grant gap): this migrations-only local database grants
-- table-level SELECT on `memories` to `postgres` only — `authenticated`
-- (and anon/service_role/PUBLIC) hold NO table SELECT here. That is a
-- pre-existing environmental gap (it affects the ORIGINAL sql function
-- identically, verified during M7-A49) and is explicitly out of scope:
-- this migration preserves SECURITY INVOKER and adds no grants. In a real
-- Supabase project `authenticated` holds that grant, so the positive
-- retrieval path runs as the owner there. Here we validate the guard's
-- admit-path + retrieval correctness by executing as the table owner
-- (postgres) with the owner's JWT, so auth.uid() resolves to the owner and
-- the guard admits; the rejections below (2-4) run as the real API role
-- `authenticated`, where they raise 'not authorized' BEFORE any table
-- access — so the grant gap is irrelevant to them.
reset role;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';

do $mv2$
declare
  n_rows int;
  only_a boolean;
begin
  select count(*) into n_rows
  from public.match_memories_v2(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768)),
    0.75, 10);
  if n_rows <> 1 then
    raise exception 'TEST FAILED: owner expected 1 matching row, got %', n_rows;
  end if;

  -- The single returned row must be A's, never B's.
  select bool_and(id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1') into only_a
  from public.match_memories_v2(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768)),
    0.75, 10);
  if only_a is distinct from true then
    raise exception 'TEST FAILED: owner result leaked a foreign row';
  end if;
  raise notice 'PASS: owner retrieves exactly their own matching memory';
end $mv2$;

-- ---------- 2) different authenticated identity is rejected ----------
-- Run as the real API role. The guard raises 'not authorized' before any
-- table access, so the local grant gap does not apply here.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';

do $mv2$
begin
  begin
    perform public.match_memories_v2(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768)),
      0.75, 10);
    raise exception 'TEST FAILED: cross-user call unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
end $mv2$;

-- ---------- 3) missing identity is rejected ----------
set local request.jwt.claims = '';

do $mv2$
begin
  begin
    perform public.match_memories_v2(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768)),
      0.75, 10);
    raise exception 'TEST FAILED: missing-identity call unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
end $mv2$;

-- ---------- 4) null p_user_id is rejected ----------
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';

do $mv2$
begin
  begin
    perform public.match_memories_v2(
      null,
      (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768)),
      0.75, 10);
    raise exception 'TEST FAILED: null p_user_id call unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
end $mv2$;

-- ---------- 5) foreign-user rows never returned / modified ----------
-- Re-confirm as the owner (postgres + owner JWT, for table access) that
-- B's row is not in the owner's result set, and that B's row is
-- byte-identical to its fixture state (a read RPC mutates nothing).
reset role;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
do $mv2$
declare
  b_leak int;
  b_times int;
  b_used timestamptz;
begin
  select count(*) into b_leak
  from public.match_memories_v2(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select ('[' || string_agg('1', ',') || ']')::vector from generate_series(1, 768)),
    0.75, 10)
  where id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  if b_leak <> 0 then
    raise exception 'TEST FAILED: foreign row B appeared in owner result set';
  end if;

  select times_used, last_used into b_times, b_used
  from memories where id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  if b_times <> 0 or b_used is not null then
    raise exception 'TEST FAILED: foreign row B was modified: times_used=%, last_used=%', b_times, b_used;
  end if;
  raise notice 'PASS: foreign row B neither returned nor modified';
end $mv2$;

-- ---------- 6) ACL matrix: unchanged, exactly two overloads ----------
do $mv2$
declare
  n_overloads int;
begin
  select count(*) into n_overloads
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  where ns.nspname = 'public' and proc.proname = 'match_memories_v2';
  if n_overloads <> 2 then
    raise exception 'TEST FAILED: expected exactly 2 match_memories_v2 overloads, got %', n_overloads;
  end if;

  if has_function_privilege('public',
       'public.match_memories_v2(uuid, vector, double precision, integer)', 'execute') then
    raise exception 'TEST FAILED: PUBLIC must not execute match_memories_v2 4-arg';
  end if;
  if has_function_privilege('anon',
       'public.match_memories_v2(uuid, vector, double precision, integer)', 'execute') then
    raise exception 'TEST FAILED: anon must not execute match_memories_v2 4-arg';
  end if;
  if not has_function_privilege('authenticated',
       'public.match_memories_v2(uuid, vector, double precision, integer)', 'execute') then
    raise exception 'TEST FAILED: authenticated must execute match_memories_v2 4-arg';
  end if;
  if has_function_privilege('service_role',
       'public.match_memories_v2(uuid, vector, double precision, integer)', 'execute') then
    raise exception 'TEST FAILED: service_role must not execute match_memories_v2 4-arg';
  end if;
  if not has_function_privilege('postgres',
       'public.match_memories_v2(uuid, vector, double precision, integer)', 'execute') then
    raise exception 'TEST FAILED: postgres must execute match_memories_v2 4-arg';
  end if;
  raise notice 'PASS ACL matrix: 4-arg posture preserved; exactly 2 overloads';
end $mv2$;

-- ---------- 7) definition: plpgsql + STABLE + INVOKER + search_path + guard ----------
do $mv2$
declare
  p record;
begin
  select l.lanname as lang, proc.prosecdef, proc.provolatile,
         proc.proconfig, proc.prosrc
    into p
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
  join pg_catalog.pg_language l on l.oid = proc.prolang
  where ns.nspname = 'public'
    and proc.proname = 'match_memories_v2'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid)
        = 'p_user_id uuid, p_query_embedding vector, p_match_threshold double precision, p_match_count integer';

  if not found then
    raise exception 'TEST FAILED: match_memories_v2(uuid, vector, double precision, integer) not found';
  end if;
  if p.lang <> 'plpgsql' then
    raise exception 'TEST FAILED: expected language plpgsql, got %', p.lang;
  end if;
  if p.provolatile <> 's' then
    raise exception 'TEST FAILED: STABLE must be preserved (provolatile=%)', p.provolatile;
  end if;
  if p.prosecdef then
    raise exception 'TEST FAILED: SECURITY INVOKER must be preserved (not DEFINER)';
  end if;
  if p.proconfig is null
     or not (p.proconfig @> array['search_path=public']::text[]) then
    raise exception 'TEST FAILED: search_path must be pinned to public; proconfig=%', p.proconfig;
  end if;
  if position('auth.uid()' in p.prosrc) = 0
     or position('p_user_id is null' in p.prosrc) = 0
     or position('not authorized' in p.prosrc) = 0 then
    raise exception 'TEST FAILED: ownership guard missing from prosrc';
  end if;
  raise notice 'PASS definition: plpgsql + STABLE + INVOKER + search_path=public + guard present';
end $mv2$;

rollback;

-- Final line for logs (no state change).
select 'MATCH_MEMORIES_V2_AUTH_TESTS: ALL PASSED' as result;
