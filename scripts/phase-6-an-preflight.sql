-- ============================================================
-- PHASE 6-AN PREFLIGHT (READ-ONLY)
-- Verifies every approved pre-call condition and captures the
-- baseline artifact counts used for post-consolidation diffs.
-- ============================================================
SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';

WITH fixture AS (
  SELECT * FROM memories WHERE id IN (
    '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
    'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
    '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
    '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
    'dcf0c503-7c1b-479c-9370-97b4cf742a54'
  )
),
checks AS (
  SELECT
    (SELECT count(*) FROM fixture) AS row_count,
    (SELECT bool_and(status = 'active') FROM fixture) AS all_active,
    (SELECT count(*) FROM fixture WHERE status <> 'active') AS non_active_count,
    (SELECT bool_and(memory_type = 'project') FROM fixture) AS all_project,
    (SELECT count(DISTINCT user_id) FROM fixture) AS distinct_users,
    (SELECT min(user_id::text) FROM fixture) AS owner_user_id,
    (SELECT count(*) FROM memory_edges
      WHERE relation = 'consolidated_into'
        AND (source_id IN (SELECT id FROM fixture) OR target_id IN (SELECT id FROM fixture))
    ) AS consolidated_into_edges,
    (SELECT count(*) FROM memory_events
      WHERE action = 'consolidate' AND memory_id IN (SELECT id FROM fixture)
    ) AS consolidate_events,
    (SELECT count(*) FROM memories) AS total_memories_before,
    (SELECT count(*) FROM memory_edges) AS total_edges_before,
    (SELECT count(*) FROM memory_events) AS total_events_before,
    now() AS checked_at
),
func AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'consolidate_memories') AS consolidate_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rollback_consolidation') AS rollback_exists,
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '0015') AS migration_0015_applied,
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '0016') AS migration_0016_applied,
    COALESCE((SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'consolidate_memories' LIMIT 1), '') AS consolidate_def,
    COALESCE((SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'match_memories_v2' LIMIT 1), '') AS match_def,
    (SELECT oid::regprocedure::text FROM pg_proc WHERE proname = 'match_memories_v2' LIMIT 1) AS match_signature
),
authz AS (
  SELECT auth.uid() AS resolved_auth_uid
)
SELECT jsonb_build_object(
  'checked_at', c.checked_at,
  'auth_uid_resolved', a.resolved_auth_uid,
  'fixture_rows', c.row_count,
  'fixture_detail', (
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id,
      'user_id', f.user_id,
      'status', f.status,
      'memory_type', f.memory_type,
      'title', f.title,
      'observation_id', f.observation_id,
      'source_v2', f.source_v2,
      'source_ref', f.source_ref,
      'tags', f.tags,
      'metadata', f.metadata,
      'times_used', f.times_used,
      'last_used', f.last_used,
      'confidence_v2', f.confidence_v2,
      'importance_v2', f.importance_v2,
      'effective_score', f.effective_score,
      'content_md5', md5(coalesce(f.content, '')),
      'content_len', length(coalesce(f.content, ''))
    ) ORDER BY f.id) FROM fixture f
  ),
  'checks', jsonb_build_object(
    'all_five_exist',            c.row_count = 5,
    'canonical_active',          EXISTS (SELECT 1 FROM fixture WHERE id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0' AND status = 'active'),
    'all_losers_active',         NOT EXISTS (SELECT 1 FROM fixture WHERE id <> '0a97a74a-cac6-4b70-ac8c-23f28f951cc0' AND status <> 'active'),
    'all_project_type',          c.all_project,
    'single_owner',              c.distinct_users = 1,
    'owner_matches_expected',    c.owner_user_id = 'b8288155-65d0-4c0a-90da-2c116237087f',
    'consolidated_into_edges',   c.consolidated_into_edges,
    'consolidate_events',        c.consolidate_events,
    'no_artifacts_yet',          c.consolidated_into_edges = 0 AND c.consolidate_events = 0,
    'none_merged',               NOT EXISTS (SELECT 1 FROM fixture WHERE status = 'merged')
  ),
  'rpc_environment', jsonb_build_object(
    'consolidate_exists',        f.consolidate_exists,
    'rollback_exists',           f.rollback_exists,
    'migration_0015_applied',    f.migration_0015_applied,
    'migration_0016_applied',    f.migration_0016_applied,
    'advisory_lock_fixed',       f.consolidate_def LIKE '%hashtextextended(p_user_id::text, hashtext(''consolidate''))%',
    'security_definer',          position('SECURITY DEFINER' in f.consolidate_def) > 0,
    'search_path_public',        f.consolidate_def LIKE '%search_path = public%' OR f.consolidate_def LIKE '%search_path TO ''public''%',
    'match_excludes_merged',     f.match_def LIKE '%merged%',
    'match_memories_v2_signature', f.match_signature
  ),
  'baseline_counts', jsonb_build_object(
    'total_memories', c.total_memories_before,
    'total_edges',    c.total_edges_before,
    'total_events',   c.total_events_before
  )
) AS preflight_report
FROM checks c, func f, authz a;
