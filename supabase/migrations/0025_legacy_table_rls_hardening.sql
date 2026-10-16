-- ============================================================
-- 0025_legacy_table_rls_hardening.sql
-- Aether / SALPA | Legacy table security hardening
-- Evidence: read-only Legacy Table Security Review + schema-
-- verified ownership analysis (tasks/milestones/projects FKs).
--
-- Scope contract:
--   * profiles, messages, knowledge, goals, projects:
--       RLS + owner policies (USING + WITH CHECK) + REVOKE anon.
--   * milestones: RLS + owner-via-project SELECT/INSERT policies.
--     No UPDATE/DELETE policies (no app path exists; deny-by-omission).
--   * tasks: RLS enabled with NO policies (deny-all quarantine).
--     Ownership model unresolved (nullable milestone_id; ON DELETE
--     SET NULL orphaning). ACCEPTED CONSEQUENCE: task rows will be
--     absent from planner context (selectTasks returns [] for all
--     users) until the ownership model is fixed. This is a
--     QUARANTINE, not a solved ownership design.
--   * migration_meta: REVOKE anon + authenticated. Only writer is
--     migration 0005 (owner role); no repository/runtime use.
--   * memory_clusters: UNCHANGED (RLS enabled, zero policies).
--   * No RPC, retrieval, embedding, reflection, or identity logic
--     touched. No application source changes.
--   * Idempotent (drop-if-exists / alter / revoke patterns).
-- ============================================================

-- ---------- 1. profiles ----------
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = (select auth.uid()));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = (select auth.uid()));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- No DELETE policy: no application path deletes profiles
-- (profiles are cascade-removed with auth.users).

revoke all on table public.profiles from anon;

-- ---------- 2. messages ----------
alter table public.messages enable row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (user_id = (select auth.uid()));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (user_id = (select auth.uid()));

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete using (user_id = (select auth.uid()));

revoke all on table public.messages from anon;
-- ---------- 3. knowledge ----------
alter table public.knowledge enable row level security;

drop policy if exists knowledge_select on public.knowledge;
create policy knowledge_select on public.knowledge
  for select using (user_id = (select auth.uid()));

drop policy if exists knowledge_insert on public.knowledge;
create policy knowledge_insert on public.knowledge
  for insert with check (user_id = (select auth.uid()));

drop policy if exists knowledge_update on public.knowledge;
create policy knowledge_update on public.knowledge
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists knowledge_delete on public.knowledge;
create policy knowledge_delete on public.knowledge
  for delete using (user_id = (select auth.uid()));

revoke all on table public.knowledge from anon;

-- ---------- 4. goals ----------
alter table public.goals enable row level security;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
  for select using (user_id = (select auth.uid()));

drop policy if exists goals_insert on public.goals;
create policy goals_insert on public.goals
  for insert with check (user_id = (select auth.uid()));

drop policy if exists goals_update on public.goals;
create policy goals_update on public.goals
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists goals_delete on public.goals;
create policy goals_delete on public.goals
  for delete using (user_id = (select auth.uid()));

revoke all on table public.goals from anon;

-- ---------- 5. projects ----------
alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (user_id = (select auth.uid()));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert with check (user_id = (select auth.uid()));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete using (user_id = (select auth.uid()));

revoke all on table public.projects from anon;
-- ---------- 6. milestones: owner via project ----------
-- project_id is NOT NULL with FK to projects (ON DELETE CASCADE),
-- so ownership is always verifiable. The subquery is itself
-- RLS-scoped by the projects policies above: a cross-user project
-- row is invisible to the checker, so the ownership check cannot
-- be weakened by probing another user's project id.
alter table public.milestones enable row level security;

drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = milestones.project_id
        and p.user_id = (select auth.uid())
    )
  );

drop policy if exists milestones_insert on public.milestones;
create policy milestones_insert on public.milestones
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = milestones.project_id
        and p.user_id = (select auth.uid())
    )
  );
-- No UPDATE/DELETE policies: no application path performs either
-- (deny-by-omission is the least-privilege default).

revoke all on table public.milestones from anon;

-- ---------- 7. tasks: deny-all quarantine ----------
-- Ownership cannot be derived (nullable milestone_id; ON DELETE
-- SET NULL orphaning). Deny-all RLS closes cross-user access for
-- every API role. Known accepted degradations until the ownership
-- follow-up: selectTasks() returns [] for all users (planner
-- context loses tasks); insertTask fails when dormant planner
-- persistence is activated; Tasks UI is already broken by
-- pre-existing schema drift (queries non-existent user_id /
-- completed columns).
alter table public.tasks enable row level security;
-- Intentionally NO policies.

revoke all on table public.tasks from anon;
-- NOTE: authenticated retains table grants but is fully blocked by
-- RLS. This is a QUARANTINE, not a solved ownership model.

-- ---------- 8. migration_meta: administrative only ----------
-- Repository evidence: sole writer is 0005 (runs as migration
-- owner); zero references in application code (repo-wide search).
revoke all on table public.migration_meta from anon;
revoke all on table public.migration_meta from authenticated;
-- service_role retained: Supabase administrative role; revoking it
-- has no application benefit and risks dashboard/API tooling.

-- ---------- 9. memory_clusters: UNCHANGED ----------
-- RLS enabled, zero policies (deny-all) is correct for the
-- currently unreferenced table. No statements.


