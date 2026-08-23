-- ============================================================
-- 0008_memory_v2_updated_at_trigger.sql
-- Aether Memory V2 | Sprint 24 audit fix
-- Restores updated_at auto-refresh for memories &
-- memory_clusters (originally defined in 0004, which was never
-- executed against the live database). Idempotent.
-- ============================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- memories
drop trigger if exists memories_updated_at on memories;
create trigger memories_updated_at
  before update on memories
  for each row execute function set_updated_at();

-- memory_clusters
drop trigger if exists memory_clusters_updated_at on memory_clusters;
create trigger memory_clusters_updated_at
  before update on memory_clusters
  for each row execute function set_updated_at();