-- ============================================================
-- 0007_lifecycle_fixes.sql
-- Aether Memory V2 | Sprint 24
-- Fixes infrastructure gaps blocking lifecycle execution.
-- ============================================================

-- Add updated_at column to memories if not present (referenced by set_updated_at trigger and forget_archived)
alter table memories
add column if not exists updated_at timestamptz default now();

-- Create a user-scoped purge function that replaces the original forget_archived
-- which lacked user_id filtering. This only handles archived -> deleted transition.
create or replace function purge_archived(
  p_user_id uuid,
  p_grace_days int default 90
)
returns int
language plpgsql
security definer
as $$
declare n int := 0;
begin
  update memories
  set status = 'deleted'
  where user_id = p_user_id
    and status = 'archived'
    and updated_at < now() - make_interval(days => p_grace_days)
    and memory_type not in ('identity','procedural');
  get diagnostics n = row_count;
  return n;
end $$;