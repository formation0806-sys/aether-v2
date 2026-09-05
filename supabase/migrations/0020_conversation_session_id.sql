-- =============================================================================
-- Conversation isolation: persist messages.session_id (uuid, nullable) via the
-- existing atomic message + memory-job RPC. The column already exists from
-- migration 0002; it was simply never written. This migration:
--
--   1. Extends create_message_and_job() with an optional p_conversation_id
--      parameter (default NULL preserves backward compatibility for any caller
--      that has not been updated yet).
--   2. Adds a covering index on (user_id, session_id, created_at) so the
--      sidebar / chat-load queries that filter by conversation can scan a
--      single B-tree instead of every message row for the user.
--
-- Backward compatibility:
--   - p_conversation_id default NULL means any old client that calls the RPC
--     with the old 2-argument signature continues to work; its rows get
--     session_id = NULL (the legacy bucket). The sidebar enumerates those
--     messages as a separate "Earlier conversations" group rather than
--     merging them with new conversations.
--   - The GRANT line is updated for the new signature only; old grants for
--     the 2-arg signature are implicitly dropped on CREATE OR REPLACE because
--     the function identity changes.
-- =============================================================================

create or replace function create_message_and_job(
  p_user_id uuid,
  p_message text,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_message_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;
  if p_message is null or btrim(p_message) = '' then
    raise exception 'message must not be empty';
  end if;
  insert into messages (user_id, role, content, session_id)
    values (p_user_id, 'user', p_message, p_conversation_id)
    returning id into v_message_id;
  insert into memory_jobs (job_type, user_id, message_id, status, payload)
    values ('memory_maintenance', p_user_id, v_message_id, 'pending',
            jsonb_build_object('message', p_message))
    on conflict (user_id, message_id) where message_id is not null do nothing;
  return v_message_id;
end;
$$;

revoke all on function public.create_message_and_job(uuid, text, uuid) from public, anon;
grant execute on function public.create_message_and_job(uuid, text, uuid) to authenticated;

create index if not exists messages_user_session_created_idx
  on messages (user_id, session_id, created_at);
