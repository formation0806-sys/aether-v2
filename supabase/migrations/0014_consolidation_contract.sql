-- ============================================================
-- 0014_consolidation_contract.sql
-- Aether Memory V2 | Phase 6-AN (part 1 of 2)
-- Provenance-preserving consolidation contract (additive only).
--
-- This file contains ONLY the schema prerequisites that do NOT
-- reference the new 'merged' enum label. It is intentionally
-- separated from 0015_consolidation_functions.sql because Supabase
-- runs each migration in a single transaction, and PostgreSQL
-- forbids using a newly-added enum label within the same
-- transaction it was added in (SQLSTATE 55P04). Splitting the
-- ADD VALUE (committed here) from its USE (in 0015) resolves it.
--
-- The five Aether fixture rows are intentionally NOT touched by
-- this migration (it only defines machinery).
-- ============================================================

-- 1. New status enum value (committed in this migration's own transaction).
alter type memory_status add value if not exists 'merged';

-- 2. Optional grouping column for consolidation batches.
alter table memory_events add column if not exists consolidation_id uuid;
