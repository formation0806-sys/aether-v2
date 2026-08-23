SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';

WITH
precondition AS (
  SELECT
    (SELECT count(*) FROM memories WHERE id IN (
      '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'
    )) AS memory_count,
    (SELECT count(*) FROM memories WHERE id IN (
      '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'
    ) AND status = 'active') AS active_count,
    (SELECT bool_and(status = 'active') FROM memories WHERE id IN (
      '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'
    )) AS all_active,
    (SELECT count(*) FROM memory_edges
     WHERE relation = 'consolidated_into'
       AND (source_id IN (
         '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
         'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
         '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
         '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
         'dcf0c503-7c1b-479c-9370-97b4cf742a54'
       ) OR target_id IN (
         '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
         'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
         '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
         '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
         'dcf0c503-7c1b-479c-9370-97b4cf742a54'
       ))) AS edge_count,
    (SELECT count(*) FROM memory_events
     WHERE action = 'consolidate'
       AND memory_id IN (
         '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
         'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
         '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
         '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
         'dcf0c503-7c1b-479c-9370-97b4cf742a54'
       )) AS consolidate_event_count
),
canonical_fields AS (
  SELECT id, status, effective_score, times_used, last_used, observation_id, content, title
  FROM memories
  WHERE id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'
),
rpc_result AS (
  SELECT consolidate_memories(
    'b8288155-65d0-4c0a-90da-2c116237087f'::uuid,
    '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'::uuid,
    ARRAY['f7c5b99b-dc2d-4edd-87f4-36a69672a023','962f14fa-c2a8-4021-a4a0-89146ceaa6a5','7fcdac75-6365-4b6c-a0ff-bb82e6a62581','dcf0c503-7c1b-479c-9370-97b4cf742a54']::uuid[]
  ) AS result
),
postcondition AS (
  SELECT
    (SELECT status FROM memories WHERE id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0') AS canonical_status,
    (SELECT count(*) FROM memories WHERE id IN (
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'
    ) AND status = 'merged') AS merged_count,
    (SELECT count(*) FROM memories WHERE id IN (
      '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'
    ) AND status = 'merged') AS total_merged_count,
    (SELECT count(*) FROM memory_edges
     WHERE relation = 'consolidated_into'
       AND target_id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'
       AND source_id IN (
         'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
         '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
         '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
         'dcf0c503-7c1b-479c-9370-97b4cf742a54'
       )) AS edge_count,
    (SELECT count(*) FROM memory_events
     WHERE action = 'consolidate'
       AND memory_id IN (
         '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
         'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
         '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
         '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
         'dcf0c503-7c1b-479c-9370-97b4cf742a54'
       )) AS event_count,
    (SELECT bool_and(status <> 'merged') FROM memories WHERE id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0') AS canonical_not_merged,
    (SELECT count(*) FROM memory_events
     WHERE action = 'consolidate'
       AND memory_id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0') AS canonical_event_count,
    (SELECT jsonb_agg(DISTINCT observation_id) FROM memories WHERE id IN (
      '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'
    )) AS preserved_observation_ids
)
SELECT jsonb_build_object(
  'precondition', (SELECT jsonb_build_object(
    'memory_count', p.memory_count,
    'active_count', p.active_count,
    'all_active', p.all_active,
    'edge_count', p.edge_count,
    'consolidate_event_count', p.consolidate_event_count
  ) FROM precondition p),
  'canonical_before', (SELECT jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'effective_score', c.effective_score,
    'times_used', c.times_used,
    'last_used', c.last_used,
    'observation_id', c.observation_id,
    'content', c.content,
    'title', c.title
  ) FROM canonical_fields c),
  'rpc_result', (SELECT result FROM rpc_result),
  'postcondition', (SELECT jsonb_build_object(
    'canonical_status', post.canonical_status,
    'merged_count', post.merged_count,
    'total_merged_count', post.total_merged_count,
    'edge_count', post.edge_count,
    'event_count', post.event_count,
    'canonical_not_merged', post.canonical_not_merged,
    'canonical_event_count', post.canonical_event_count,
    'preserved_observation_ids', post.preserved_observation_ids
  ) FROM postcondition post)
) AS report;
