-- ============================================================
-- 0011_memory_events_corroboration.sql
-- Aether Memory V2 | Corroboration provenance
--
-- Establishes a reliable "independent observation" identity so that the
-- existing CONFIDENCE_CORROBORATION_STEP rule can be applied EXACTLY ONCE
-- per (memory_id, message_id).
--
-- Observation boundary = one user message (messages.id).
-- Exactly-once        = partial unique index on (memory_id, message_id)
--                       where message_id is not null.
-- Atomicity           = corroborate_memory() inserts on conflict do nothing,
--                       then bumps confidence_v2 only when a row was inserted.
--
-- Additive / idempotent / safe for existing memory_events rows.
-- ============================================================

-- ---- message identity ----------------------------------------------
alter table memory_events
add column if not exists message_id uuid references messages(id) on delete set null;

-- Exactly-once: at most one corroboration row per (memory, message).
-- Partial index: rows with message_id IS NULL are ignored by the uniqueness
-- guarantee (NULL never corroborates, matching the Postgres NULL semantics).
create unique index if not exists memory_events_memory_message_uidx
on memory_events (memory_id, message_id)
where message_id is not null;

-- ---- RLS (ownership: memory_events.user_id = auth.uid()) -------------
alter table memory_events enable row level security;

drop policy if exists memory_events_select on memory_events;
create policy memory_events_select
on memory_events
for select
using (auth.uid() = user_id);

drop policy if exists memory_events_insert on memory_events;
create policy memory_events_insert
on memory_events
for insert
with check (auth.uid() = user_id);

drop policy if exists memory_events_update on memory_events;
create policy memory_events_update
on memory_events
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists memory_events_delete on memory_events;
create policy memory_events_delete
on memory_events
for delete
using (auth.uid() = user_id);

-- ---- atomic corroboration RPC -----------------------------------------
-- Records one provenance row for (memory, message). On the FIRST occurrence
-- for that pair it also bumps memories.confidence_v2 by the corroboration
-- step (0.05, matching CONFIDENCE_CORROBORATION_STEP in lib/memory/constants.ts),
-- bounded to 1.0, and returns true. Repeated calls for the same pair return
-- false and never change confidence (exactly-once, race-safe).
create or replace function corroborate_memory(
    p_memory_id uuid,
    p_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    inserted boolean := false;
begin
    -- Only corroborate memories owned by the calling user.
    if exists (
        select 1 from memories
        where id = p_memory_id and user_id = auth.uid()
    ) then
        insert into memory_events (user_id, memory_id, message_id, action, payload)
        values (
            auth.uid(),
            p_memory_id,
            p_message_id,
            'corroborate',
            jsonb_build_object('step', 0.05)
        )
        on conflict (memory_id, message_id) where message_id is not null
        do nothing;

        -- `found` is true only when the INSERT actually inserted a row.
        if found then
            update memories
            set confidence_v2 = least(coalesce(confidence_v2, 0.5) + 0.05, 1.0)
            where id = p_memory_id and user_id = auth.uid();
            inserted := true;
        end if;
    end if;

    return inserted;
end $$;

grant execute on function corroborate_memory(uuid, uuid) to anon, authenticated;
