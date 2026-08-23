SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';

WITH
fixture AS (
  SELECT id, status, memory_type, observation_id, content, summary, source_v2, source_ref,
         tags, metadata, times_used, effective_score, confidence_v2, importance_v2
  FROM memories
  WHERE id IN (
    '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
    'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
    '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
    '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
    'dcf0c503-7c1b-479c-9370-97b4cf742a54'
  )
),
losers AS (
  SELECT jsonb_agg(id ORDER BY id) AS ids
  FROM fixture
  WHERE id <> '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'
),
obs AS (
  SELECT jsonb_agg(observation_id) AS ids
  FROM fixture
),
checks AS (
  SELECT
    (SELECT count(*) FROM fixture) = 5 AS all_five_exist,
    (SELECT bool_and(status = 'active') FROM fixture) AS all_active,
    (SELECT bool_and(memory_type = 'project') FROM fixture) AS all_project,
    (SELECT ids FROM obs) = '["63cc1fa2-4b37-471d-ada5-3847b0b7d2b9","85201f65-9c41-4011-b0c9-e641f4972769","2d66fbf1-f76f-48ca-8074-f8c7b2d150a7","f488790e-40fb-4af4-8630-5926e09eb99a","7214f942-29c1-436e-8ab2-0162d9011c49"]'::jsonb AS observation_ids_unchanged,
    (SELECT bool_and(content IS NOT NULL AND summary IS NOT NULL AND source_v2 IS NOT NULL AND tags IS NOT NULL) FROM fixture) AS text_fields_present,
    (SELECT bool_and(times_used IS NOT NULL AND effective_score IS NOT NULL AND confidence_v2 IS NOT NULL AND importance_v2 IS NOT NULL) FROM fixture) AS numeric_fields_present,
    (SELECT count(*) FROM memory_edges WHERE relation = 'consolidated_into' AND (source_id IN ('0a97a74a-cac6-4b70-ac8c-23f28f951cc0','f7c5b99b-dc2d-4edd-87f4-36a69672a023','962f14fa-c2a8-4021-a4a0-89146ceaa6a5','7fcdac75-6365-4b6c-a0ff-bb82e6a62581','dcf0c503-7c1b-479c-9370-97b4cf742a54') OR target_id IN ('0a97a74a-cac6-4b70-ac8c-23f28f951cc0','f7c5b99b-dc2d-4edd-87f4-36a69672a023','962f14fa-c2a8-4021-a4a0-89146ceaa6a5','7fcdac75-6365-4b6c-a0ff-bb82e6a62581','dcf0c503-7c1b-479c-9370-97b4cf742a54'))) = 0 AS edges_zero,
    (SELECT count(*) FROM memory_events WHERE action = 'consolidate' AND memory_id IN ('0a97a74a-cac6-4b70-ac8c-23f28f951cc0','f7c5b99b-dc2d-4edd-87f4-36a69672a023','962f14fa-c2a8-4021-a4a0-89146ceaa6a5','7fcdac75-6365-4b6c-a0ff-bb82e6a62581','dcf0c503-7c1b-479c-9370-97b4cf742a54')) = 0 AS events_zero,
    (SELECT bool_and(status <> 'merged') FROM fixture) AS none_merged,
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '0014') AS migration_0014,
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '0015') AS migration_0015,
    EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '0016') AS migration_0016,
    pg_get_functiondef('match_memories_v2'::regproc) LIKE '%merged%' AS match_excludes_merged,
    (SELECT id FROM fixture ORDER BY times_used DESC, effective_score DESC, confidence_v2 DESC, id ASC LIMIT 1) = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0' AS canonical_correct,
    (SELECT ids FROM losers) = '["7fcdac75-6365-4b6c-a0ff-bb82e6a62581","962f14fa-c2a8-4021-a4a0-89146ceaa6a5","dcf0c503-7c1b-479c-9370-97b4cf742a54","f7c5b99b-dc2d-4edd-87f4-36a69672a023"]'::jsonb AS losers_exact,
    pg_get_functiondef('consolidate_memories'::regproc) LIKE '%hashtextextended(p_user_id::text, hashtext(''consolidate''))%' AS rpc_exists_and_fixed,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rollback_consolidation') AS rollback_exists,
    (SELECT count(*) FROM memory_events WHERE action = 'consolidate') = 0 AS no_global_artifacts
  FROM fixture LIMIT 1
)
SELECT jsonb_build_object(
  'all_five_exist', c.all_five_exist,
  'all_active', c.all_active,
  'all_project', c.all_project,
  'observation_ids_unchanged', c.observation_ids_unchanged,
  'text_fields_present', c.text_fields_present,
  'numeric_fields_present', c.numeric_fields_present,
  'edges_zero', c.edges_zero,
  'events_zero', c.events_zero,
  'none_merged', c.none_merged,
  'migration_0014', c.migration_0014,
  'migration_0015', c.migration_0015,
  'migration_0016', c.migration_0016,
  'match_excludes_merged', c.match_excludes_merged,
  'canonical_correct', c.canonical_correct,
  'losers_exact', c.losers_exact,
  'rpc_exists_and_fixed', c.rpc_exists_and_fixed,
  'rollback_exists', c.rollback_exists,
  'no_global_artifacts', c.no_global_artifacts,
  'all_pass', (
    c.all_five_exist AND c.all_active AND c.all_project AND c.observation_ids_unchanged AND
    c.text_fields_present AND c.numeric_fields_present AND c.edges_zero AND c.events_zero AND
    c.none_merged AND c.migration_0014 AND c.migration_0015 AND c.migration_0016 AND
    c.match_excludes_merged AND c.canonical_correct AND c.losers_exact AND
    c.rpc_exists_and_fixed AND c.rollback_exists AND c.no_global_artifacts
  )
) AS gate
FROM checks c;
