-- 0012_memory_observation_provenance.sql
-- Aether Memory V2 — Provenance foundation
--
-- Adds observation_id to memories table so that each memory can trace
-- its originating user message. This is additive; existing rows get NULL.
--
-- observation_id = the messages.id that originally produced this memory.
-- NULL for reflections, historical rows, and any memory without
-- a user-message origin.
--
-- Add observation_id column if not exists
alter table memories
add column if not exists observation_id uuid
references messages(id) on delete set null;

-- Add index for provenance query performance
create index if not exists memories_observation_id_idx
on memories (observation_id) where observation_id is not null;