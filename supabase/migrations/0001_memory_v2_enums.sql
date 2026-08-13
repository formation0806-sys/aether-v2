-- ============================================================
-- 0001_memory_v2_enums.sql — Aether Memory V2 | Phase P1
-- Creates the three memory enums idempotently (CREATE TYPE has
-- no IF NOT EXISTS, so we guard with a DO block).
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_type') then
    create type memory_type as enum
      ('semantic','identity','procedural','project','episodic','reflection','conversation','working');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_status') then
    create type memory_status as enum
      ('candidate','active','fading','archived','deleted');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'memory_source') then
    create type memory_source as enum
      ('user','assistant','system','extractor','reflection','consolidation','import','merge');
  end if;
end $$;
