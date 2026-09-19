-- ============================================================
-- PHASE 6-AO STEP 1 — LIVE CATALOG VERIFICATION (READ-ONLY)
--
-- Purpose: convert audit findings D1 (rollback_consolidation
-- advisory-lock defect) and G6 (RLS enforceability) from
-- assumptions into verified live-database facts.
--
-- SAFETY CONTRACT:
--   * READ-ONLY queries exclusively. Every statement is a
--     SELECT against system catalogs or application tables.
--     No INSERT/UPDATE/DELETE/DDL/RPC anywhere in this file.
--   * rollback_consolidation / consolidate_memories /
--     purge_archived are NEVER invoked — only inspected via
--     pg_proc / pg_get_functiondef / aclexplode.
--   * Run inside a read-only transaction when possible.
--
-- HOW TO RUN (choose one):
--   a) Supabase Dashboard > SQL Editor: paste entire file.
--   b) psql "postgresql://...db.sqbdxttrdmlwlmslzznv..." \
--        -f scripts/phase-6-ao-step1-catalog.sql
--      (recommend PGOPTIONS='-c default_transaction_read_only=on')
--
-- Sections:
--   0  Project identity + Phase-6-AN fixture state
--   A  rollback_consolidation definition probe (D1)
--   A2 consolidate_memories control probe (validates method)
--   B  RLS enablement probe (G6)
--   C  Policy inventory probe (G6)
--   D  purge_archived config + effective ACL probe
--   E  Supporting ACL inventory for memory write-path RPCs
-- ============================================================

-- ------------------------------------------------------------
-- SECTION 0 — IDENTITY + FIXTURE STATE
-- Expect: canonical 0a97a74a = active; four losers = merged;
-- canonical_incoming_edges = 4; batch_events = 5;
-- total rows = 50 (matches Phase-6-AN preflight baseline).
-- ------------------------------------------------------------

select
    current_database()  as database_name,
    current_user        as connecting_role,
    version()           as server_version;

select m.id::text, m.status::text, m.memory_type::text
from public.memories m
where m.id in (
    '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
    'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
    '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
    '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
    'dcf0c503-7c1b-479c-9370-97b4cf742a54'
)
order by m.id;

select
    (select count(*) from public.memory_edges
     where target_id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'
       and relation  = 'consolidated_into')          as canonical_incoming_edges,
    (select count(*) from public.memory_events
     where action = 'consolidate'
       and consolidation_id = '20e06196-d82a-4bcd-9f2a-349a1e681826') as batch_events,
    (select count(*) from public.memories)           as total_memories;

-- ------------------------------------------------------------
-- SECTION A — D1: rollback_consolidation LIVE DEFINITION
-- lock_fixed_form : ...hashtextextended(p_user_id::text, hashtext('consolidate'))
-- lock_broken_form: ...hashtextextended(p_user_id::text, 'consolidate'...
-- EXPECTED IF BUG PRESENT: lock_broken_form = true.
-- The function is NOT invoked.
-- ------------------------------------------------------------

select
    p.oid::regprocedure::text   as signature,
    l.lanname                   as language,
    p.prosecdef                 as security_definer,
    p.proconfig                 as proconfig,
    pg_get_userbyid(p.proowner) as owner,
    pg_get_functiondef(p.oid)   as definition,
    (pg_get_functiondef(p.oid) like '%hashtextextended(p_user_id::text, hashtext(''consolidate''))%')
                                as lock_fixed_form,
    (pg_get_functiondef(p.oid) like '%hashtextextended(p_user_id::text, ''consolidate''%')
                                as lock_broken_form
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname = 'rollback_consolidation';

-- ------------------------------------------------------------
-- SECTION A2 — CONTROL: consolidate_memories (0016 applied)
-- MUST report lock_fixed_form = true / lock_broken_form =
-- false; validates the LIKE-based detection used above.
-- ------------------------------------------------------------

select
    p.oid::regprocedure::text   as signature,
    p.prosecdef                 as security_definer,
    p.proconfig                 as proconfig,
    pg_get_functiondef(p.oid)   as definition,
    (pg_get_functiondef(p.oid) like '%hashtextextended(p_user_id::text, hashtext(''consolidate''))%')
                                as lock_fixed_form,
    (pg_get_functiondef(p.oid) like '%hashtextextended(p_user_id::text, ''consolidate''%')
                                as lock_broken_form
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'consolidate_memories';

-- ------------------------------------------------------------
-- SECTION B — G6: RLS ENABLEMENT (four target tables)
-- relrowsecurity      : RLS enforced for applicable commands
-- relforcerowsecurity : RLS forced even for table owner
-- session GUC         : driver-level row_security setting
-- ------------------------------------------------------------

select
    c.relname                       as table_name,
    c.relrowsecurity                as rls_enabled,
    c.relforcerowsecurity           as rls_forced,
    current_setting('row_security') as session_row_security_guc
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('memories', 'memory_edges', 'memory_events', 'memory_jobs')
order by c.relname;

-- ------------------------------------------------------------
-- SECTION C — POLICY INVENTORY (same four tables)
-- ------------------------------------------------------------

select
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual        as using_expression,
    with_check  as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in ('memories', 'memory_edges', 'memory_events', 'memory_jobs')
order by tablename, policyname;

-- ------------------------------------------------------------
-- SECTION D — PURGE_ARCHIVED CONFIG + EFFECTIVE ACLS
-- Effective grants expanded from proacl, falling back to
-- acldefault('f', owner): a NULL proacl means PostgreSQL's
-- default, i.e. EXECUTE granted to PUBLIC.
-- The function is NOT invoked.
-- ------------------------------------------------------------

select
    p.oid::regprocedure::text   as signature,
    l.lanname                   as language,
    p.prosecdef                 as security_definer,
    p.proconfig                 as proconfig,
    pg_get_userbyid(p.proowner) as owner,
    pg_get_functiondef(p.oid)   as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname = 'purge_archived';

select distinct
    case when g.grantee = 0 then 'PUBLIC'
         else r.rolname end     as grantee,
    g.privilege_type            as privilege_type,
    (p.proacl is null)          as using_default_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
) g
left join pg_roles r on r.oid = g.grantee
where n.nspname = 'public'
  and p.proname = 'purge_archived'
order by grantee, privilege_type;

-- ------------------------------------------------------------
-- SECTION E — SUPPORTING ACL INVENTORY (write-path RPCs)
-- Context for interpreting D/G6: who may EXECUTE each memory
-- write-path function. Read-only metadata only.
-- ------------------------------------------------------------

select
    p.proname                 as function_name,
    p.oid::regprocedure::text as signature,
    p.prosecdef               as security_definer,
    case when g.grantee = 0 then 'PUBLIC'
         else r.rolname end   as grantee,
    g.privilege_type          as privilege_type,
    (p.proacl is null)        as using_default_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
) g
left join pg_roles r on r.oid = g.grantee
where n.nspname = 'public'
  and p.proname in (
      'purge_archived',
      'match_memories_v2',
      'touch_memories',
      'corroborate_memory',
      'consolidate_memories',
      'rollback_consolidation'
  )
order by function_name, grantee;

