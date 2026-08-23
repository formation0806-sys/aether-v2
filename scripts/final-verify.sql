SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';

WITH
func AS (
  SELECT pg_get_functiondef('consolidate_memories'::regproc) AS def
),
checks AS (
  SELECT
    (SELECT def FROM func) LIKE '%SET search_path TO ''public''%' AS search_path_public,
    (SELECT def FROM func) LIKE '%ownership checks remain%' AS dummy1,
    (SELECT def FROM func) LIKE '%raise exception ''not authorized''%' AS auth_checks,
    (SELECT def FROM func) LIKE '%keep_already_consolidated%' AS idempotency,
    (SELECT def FROM func) LIKE '%merge_already_merged%' AS merge_idempotency,
    (SELECT def FROM func) LIKE '%insert into memory_edges%' AS edge_creation,
    (SELECT def FROM func) LIKE '%insert into memory_events%' AS event_creation,
    (SELECT def FROM func) LIKE '%status = ''merged''%' AS status_merge,
    (SELECT def FROM func) LIKE '%pre_times_used%' AS snapshot,
    (SELECT has_function_privilege('authenticated', 'consolidate_memories(uuid, uuid, uuid[])', 'EXECUTE')) AS execute_priv,
    (SELECT pg_get_functiondef('rollback_consolidation'::regproc) LIKE '%delete from memory_edges%') AS rollback_edges,
    (SELECT pg_get_functiondef('match_memories_v2'::regproc) LIKE '%merged%') AS match_excludes_merged
)
SELECT jsonb_build_object(
  'search_path_public', c.search_path_public,
  'auth_checks', c.auth_checks,
  'idempotency', c.idempotency,
  'merge_idempotency', c.merge_idempotency,
  'edge_creation', c.edge_creation,
  'event_creation', c.event_creation,
  'status_merge', c.status_merge,
  'snapshot', c.snapshot,
  'execute_priv', c.execute_priv,
  'rollback_edges', c.rollback_edges,
  'match_excludes_merged', c.match_excludes_merged
) AS report
FROM checks c;
