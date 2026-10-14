-- ============================================================
-- 0022_touch_memories_auth_guard.sql
-- Aether Memory V2 | M7-A45 (implements the reviewed M7-A44 plan)
-- ============================================================
-- SECURITY REPAIR: public.touch_memories(uuid, uuid[])
--
-- Verified defect (0019_harden_rpc_auth.sql:26-35):
--   * function is SECURITY DEFINER
--   * search_path is unpinned (no SET search_path)
--   * NO auth.uid() ownership guard. p_user_id is caller-supplied,
--     so any `authenticated` caller could pass ANOTHER user's id
--     and bump times_used / last_used on that user's memories
--     (metadata-only, but a cross-user write nonetheless).
--
-- Sole production caller chain (UNCHANGED by this migration):
--   app/api/chat/route.ts (session user via supabase.auth.getUser)
--     -> lib/memory/retrieve.ts -> touchMemories(userId, surfacedIds)
--     -> lib/repositories/memory.repository.ts -> rpc('touch_memories')
--   plus the (currently unimported) learning-apply writer path.
-- Both pass the SESSION user's id, so auth.uid() == p_user_id for
-- every legitimate call; the new guard only blocks injected ids.
--
-- This file contains ONLY one CREATE OR REPLACE FUNCTION of
-- public.touch_memories(uuid, uuid[]). Intentional deltas vs 0019
-- (the COMPLETE delta set):
--   + new `set search_path = public` clause
--   + new ownership-guard block (idiom mirrors 0015:92-93,
--     0016:21-22, 0018, and 0019's forget_archived/apply_memory_decay)
--   + LANGUAGE sql -> LANGUAGE plpgsql (required to RAISE; signature
--     and RETURNS void are unchanged, so CREATE OR REPLACE applies
--     in place and the existing EXECUTE ACL is preserved)
-- Preserved verbatim from 0019: signature + parameter names,
-- `security definer`, RETURNS void, and the UPDATE predicate
-- (times_used + 1, last_used = now(), id = any(p_ids) AND
-- user_id = p_user_id).
--
-- PRIVILEGES: none added, none removed. CREATE OR REPLACE preserves
-- the existing ACL (authenticated + postgres EXECUTE; PUBLIC/anon/
-- service_role denied, per the post-0021 posture). The legacy 1-arg
-- touch_memories(uuid[]) overload stays revoked (0021) and is NOT
-- touched here.
--
-- LOCAL-ONLY: validated and applied on the LOCAL development
-- database (docker supabase_db_aether-v2) only, after a rolled-back
-- dry run. Remote application, promotion, and approval remain fully
-- owner-gated; this file must not reach any remote project until the
-- owner approves.
-- ============================================================

create or replace function touch_memories(
  p_user_id uuid,
  p_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ownership guard: fail closed on missing identity, missing
  -- p_user_id, or a mismatch between auth.uid() and p_user_id.
  -- (p_user_id IS NULL must be checked first: without it the
  -- comparison below would evaluate NULL and fall through.)
  if p_user_id is null
     or auth.uid() is null
     or auth.uid() <> p_user_id then
    raise exception 'not authorized';
  end if;

  -- User scoping preserved verbatim from 0019.
  update memories
    set times_used = times_used + 1,
        last_used  = now()
  where id = any(p_ids)
    and user_id = p_user_id;
end $$;
-- END OF 0022.
