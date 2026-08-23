-- ============================================================
-- 0010_memory_edges_rls.sql — Aether Memory V2 | Phase P4
-- User-scoped RLS policies for memory_edges table
-- Enforces ownership: memory_edges.user_id = auth.uid()
-- ============================================================

drop policy if exists memory_edges_select on memory_edges;
create policy memory_edges_select
on memory_edges
for select
using (auth.uid() = user_id);

drop policy if exists memory_edges_insert on memory_edges;
create policy memory_edges_insert
on memory_edges
for insert
with check (auth.uid() = user_id);

drop policy if exists memory_edges_update on memory_edges;
create policy memory_edges_update
on memory_edges
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists memory_edges_delete on memory_edges;
create policy memory_edges_delete
on memory_edges
for delete
using (auth.uid() = user_id);