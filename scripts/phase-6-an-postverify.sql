-- ============================================================
-- PHASE 6-AN POST-CONSOLIDATION VERIFICATION (READ-ONLY)
-- Baseline (preflight @ 2026-08-23T17:56:43.461877+00:00):
--   total_memories = 50, total_edges = 0, total_events = 8
-- Consolidation batch id returned by RPC:
--   20e06196-d82a-4bcd-9f2a-349a1e681826
-- ============================================================
SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';

WITH
const AS (
  SELECT
    '2026-08-23T17:56:43.461877+00:00'::timestamptz AS baseline_at,
    '20e06196-d82a-4bcd-9f2a-349a1e681826'::uuid AS batch_id,
    '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'::uuid AS canonical_id,
    ARRAY[
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023'::uuid,
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5'::uuid,
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581'::uuid,
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'::uuid
    ]::uuid[] AS loser_ids,
    'b8288155-65d0-4c0a-90da-2c116237087f'::uuid AS owner_id
),
fixture AS (
  SELECT m.* FROM memories m, const c
  WHERE m.id = c.canonical_id OR m.id = ANY(c.loser_ids)
),
mem_state AS (
  SELECT
    (SELECT status FROM fixture WHERE id = (SELECT canonical_id FROM const)) AS canonical_status,
    (SELECT count(*) FROM fixture WHERE id <> (SELECT canonical_id FROM const) AND status = 'merged') AS losers_merged_count,
    (SELECT count(*) FROM fixture WHERE status = 'active') AS active_count_in_five,
    (SELECT count(*) FROM fixture) AS five_row_count
),
edges AS (
  SELECT e.source_id, e.target_id, e.relation, e.user_id
  FROM memory_edges e, const c
  WHERE e.relation = 'consolidated_into'
    AND (e.source_id = c.canonical_id OR e.target_id = c.canonical_id OR e.source_id = ANY(c.loser_ids) OR e.target_id = ANY(c.loser_ids))
),
edge_check AS (
  SELECT
    (SELECT count(*) FROM edges) AS edge_total,
    (SELECT count(*) FROM edges WHERE target_id = (SELECT canonical_id FROM const) AND source_id = ANY(SELECT unnest((SELECT loser_ids FROM const))) AND user_id = (SELECT owner_id FROM const)) AS edges_correct_direction_owner,
    (SELECT jsonb_agg(jsonb_build_object('loser', s.source_id, 'canonical', s.target_id) ORDER BY s.source_id) FROM edges s) AS edge_list
),
events_all AS (
  SELECT ev.* FROM memory_events ev, const c
  WHERE ev.action = 'consolidate'
    AND (ev.memory_id = c.canonical_id OR ev.memory_id = ANY(c.loser_ids))
),
event_check AS (
  SELECT
    (SELECT count(*) FROM events_all) AS event_total,
    (SELECT count(DISTINCT consolidation_id) FROM events_all) AS distinct_batch_ids,
    (SELECT min(consolidation_id::text)::uuid FROM events_all) AS batch_seen,
    (SELECT count(*) FROM events_all WHERE memory_id = ANY(SELECT unnest((SELECT loser_ids FROM const)))) AS loser_events,
    (SELECT count(*) FROM events_all WHERE memory_id = (SELECT canonical_id FROM const)) AS canonical_events,
    (SELECT bool_and(created_at >= (SELECT baseline_at FROM const)) FROM events_all) AS all_created_after_baseline,
    (SELECT jsonb_agg(memory_id::text ORDER BY created_at, memory_id::text) FROM events_all WHERE memory_id = ANY(SELECT unnest((SELECT loser_ids FROM const)))) AS loser_event_memory_ids,
    (SELECT payload FROM events_all WHERE memory_id = (SELECT canonical_id FROM const) LIMIT 1) AS canonical_event_payload
),
prov AS (
  SELECT
    u.id AS loser_id,
    ev.payload,
    (ev.payload->>'observation_id')::uuid = u.observation_id AND u.observation_id IS NOT NULL AS prov_observation_id,
    ev.payload->>'source_v2' = u.source_v2::text AS prov_source_v2,
    (ev.payload->>'source_ref' IS NULL AND u.source_ref IS NULL) OR ev.payload->>'source_ref' = u.source_ref AS prov_source_ref,
    ev.payload->>'title' = u.title AS prov_title,
    ev.payload->>'content' = u.content AS prov_content_exact,
    ev.payload->'tags' = to_jsonb(u.tags) AS prov_tags,
    ev.payload->'metadata' = to_jsonb(u.metadata) AS prov_metadata,
    (ev.payload->>'times_used')::int = u.times_used AS prov_times_used,
    (ev.payload->>'last_used')::timestamptz = u.last_used AS prov_last_used,
    (ev.payload->>'confidence_v2')::numeric = u.confidence_v2 AS prov_confidence,
    (ev.payload->>'importance_v2')::numeric = u.importance_v2 AS prov_importance,
    (ev.payload->>'effective_score')::numeric = u.effective_score AS prov_effective_score,
    ev.payload->>'pre_status' = 'active' AS prov_pre_status_active
  FROM events_all ev
  JOIN const c ON ev.consolidation_id = c.batch_id
  JOIN memories u ON u.id = ev.memory_id
  WHERE ev.memory_id = ANY(c.loser_ids)
)
,
prov_baseline AS (
  SELECT
    p.loser_id,
    p.prov_observation_id AND p.prov_source_v2 AND p.prov_source_ref AND p.prov_title
      AND p.prov_content_exact AND p.prov_tags AND p.prov_metadata
      AND p.prov_times_used AND p.prov_last_used AND p.prov_confidence
      AND p.prov_importance AND p.prov_effective_score AND p.prov_pre_status_active AS all_provenance_fields_match,
    md5(COALESCE((p.payload->>'content'), '')) = CASE p.loser_id
      WHEN 'f7c5b99b-dc2d-4edd-87f4-36a69672a023'::uuid THEN '2e79af082b0aae17a7cb513110569af9'
      WHEN '962f14fa-c2a8-4021-a4a0-89146ceaa6a5'::uuid THEN '47c182e15043db34ee51187deef14276'
      WHEN '7fcdac75-6365-4b6c-a0ff-bb82e6a62581'::uuid THEN '438ce99b014df1512fd0835c02bc9bfc'
      WHEN 'dcf0c503-7c1b-479c-9370-97b4cf742a54'::uuid THEN '0077c0ba7da9ed715251763082145175'
    END AS content_matches_preflight_baseline,
    (p.payload->>'observation_id')::uuid = CASE p.loser_id
      WHEN 'f7c5b99b-dc2d-4edd-87f4-36a69672a023'::uuid THEN '85201f65-9c41-4011-b0c9-e641f4972769'::uuid
      WHEN '962f14fa-c2a8-4021-a4a0-89146ceaa6a5'::uuid THEN '2d66fbf1-f76f-48ca-8074-f8c7b2d150a7'::uuid
      WHEN '7fcdac75-6365-4b6c-a0ff-bb82e6a62581'::uuid THEN 'f488790e-40fb-4af4-8630-5926e09eb99a'::uuid
      WHEN 'dcf0c503-7c1b-479c-9370-97b4cf742a54'::uuid THEN '7214f942-29c1-436e-8ab2-0162d9011c49'::uuid
    END AS observation_matches_preflight_baseline
  FROM prov p
),
canon AS (
  SELECT
    k.id, k.status, k.times_used, k.last_used, k.effective_score, k.updated_at,
    md5(COALESCE(k.content,'')) = 'b9332cf68bb6efbbf788aaaaf3a426dc' AS content_unchanged_vs_baseline,
    k.observation_id = '63cc1fa2-4b37-471d-ada5-3847b0b7d2b9'::uuid AS observation_unchanged_vs_baseline,
    k.last_used = '2026-08-21T13:13:53.343037+00:00'::timestamptz AS last_used_is_pool_max,
    k.updated_at >= (SELECT baseline_at FROM const) AS updated_at_bumped,
    k.effective_score = round(
      (
        COALESCE(k.importance_v2, 0.5) * 0.7
        + 0.2 * exp(-ln(2.0) * EXTRACT(epoch FROM (k.updated_at - k.last_used)) / 86400.0 / 180.0)
      )::numeric, 3) AS effective_score_matches_contract_formula,
    (SELECT ce.payload->>'pre_times_used' FROM memory_events ce WHERE ce.action='consolidate' AND ce.memory_id = k.id LIMIT 1) = '0' AS event_pre_times_used_ok,
    ((SELECT ce.payload->>'pre_last_used' FROM memory_events ce WHERE ce.action='consolidate' AND ce.memory_id = k.id LIMIT 1)::timestamptz) = '2026-08-21T13:11:58.169792+00:00'::timestamptz AS event_pre_last_used_ok,
    (SELECT ce.payload->>'pre_effective_score' FROM memory_events ce WHERE ce.action='consolidate' AND ce.memory_id = k.id LIMIT 1) = '0.674' AS event_pre_effective_score_ok,
    (SELECT ce.payload->>'role' FROM memory_events ce WHERE ce.action='consolidate' AND ce.memory_id = k.id LIMIT 1) = 'canonical' AS event_role_canonical,
    (SELECT count(*) FROM jsonb_array_elements_text((SELECT ce.payload->'merged_ids' FROM memory_events ce WHERE ce.action='consolidate' AND ce.memory_id = k.id LIMIT 1)) x(g) WHERE x.g::uuid = ANY(SELECT unnest((SELECT loser_ids FROM const)))) = 4 AS event_merged_ids_ok
  FROM memories k
  WHERE k.id = '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'
)
,
retrieval_check AS (
  SELECT
    (SELECT count(*) FROM match_memories_v2((SELECT owner_id FROM const), (SELECT embedding FROM memories WHERE id = (SELECT canonical_id FROM const)), 0.10::float, 50)) AS candidates_returned,
    EXISTS (
      SELECT 1 FROM match_memories_v2((SELECT owner_id FROM const), (SELECT embedding FROM memories WHERE id = (SELECT canonical_id FROM const)), 0.10::float, 50) r
      WHERE r.id = (SELECT canonical_id FROM const)
    ) AS canonical_retrievable,
    (
      SELECT count(*) FROM match_memories_v2((SELECT owner_id FROM const), (SELECT embedding FROM memories WHERE id = (SELECT canonical_id FROM const)), 0.10::float, 50) r
      WHERE r.id = ANY(SELECT unnest((SELECT loser_ids FROM const)))
    ) AS losers_returned_count,
    (SELECT jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'similarity', round(r.similarity::numeric, 4)) ORDER BY r.similarity DESC)
       FROM match_memories_v2((SELECT owner_id FROM const), (SELECT embedding FROM memories WHERE id = (SELECT canonical_id FROM const)), 0.10::float, 50) r) AS retrieval_list,
    (SELECT embedding IS NOT NULL FROM memories WHERE id = (SELECT canonical_id FROM const)) AS canonical_embedding_available
),
safety AS (
  SELECT
    (SELECT count(*) FROM memories) AS total_memories_after,
    (SELECT count(*) FROM memory_edges) AS total_edges_after,
    (SELECT count(*) FROM memory_events) AS total_events_after,
    (SELECT count(*) FROM memories WHERE updated_at > (SELECT baseline_at FROM const) AND id NOT IN (
      '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'::uuid,
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023'::uuid,
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5'::uuid,
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581'::uuid,
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'::uuid
    )) AS unrelated_memory_mutations,
    (SELECT count(*) FROM memory_edges WHERE NOT (
      relation = 'consolidated_into' AND target_id = (SELECT canonical_id FROM const) AND source_id = ANY(SELECT unnest((SELECT loser_ids FROM const)))
    )) AS unexpected_edges
)
SELECT jsonb_build_object(
  'A_consolidation_result', jsonb_build_object(
    'status', 'SUCCESS',
    'batch_id', (SELECT batch_id FROM const),
    'canonical_id', (SELECT canonical_id FROM const),
    'loser_ids', (SELECT to_jsonb(loser_ids) FROM const)
  ),
  'B_memory_status', jsonb_build_object(
    'canonical_is_active', ms.canonical_status = 'active',
    'losers_merged_count', ms.losers_merged_count,
    'rows_still_exist_no_hard_delete', ms.five_row_count = 5,
    'fixture_statuses', (SELECT jsonb_object_agg(id::text, status) FROM fixture)
  ),
  'C_edge_verification', jsonb_build_object(
    'expected', 4,
    'actual', ec.edge_total,
    'all_loser_to_canonical_with_owner', ec.edges_correct_direction_owner = 4,
    'edge_list', ec.edge_list
  ),
  'D_event_verification', jsonb_build_object(
    'expected_total', 5,
    'actual_total', ev.event_total,
    'loser_events', ev.loser_events,
    'canonical_events', ev.canonical_events,
    'single_batch_id', ev.distinct_batch_ids = 1,
    'batch_id_matches_rpc_return', ev.batch_seen = (SELECT batch_id FROM const),
    'all_created_after_baseline', ev.all_created_after_baseline,
    'canonical_payload', ev.canonical_event_payload
  ),
  'E_provenance_verification', jsonb_build_object(
    'per_loser', (
      SELECT jsonb_agg(jsonb_build_object(
        'loser_id', pb.loser_id,
        'observation_id', pr.prov_observation_id,
        'source_v2', pr.prov_source_v2,
        'source_ref', pr.prov_source_ref,
        'title', pr.prov_title,
        'content_exact', pr.prov_content_exact,
        'tags', pr.prov_tags,
        'metadata', pr.prov_metadata,
        'times_used', pr.prov_times_used,
        'last_used', pr.prov_last_used,
        'confidence_v2', pr.prov_confidence,
        'importance_v2', pr.prov_importance,
        'effective_score', pr.prov_effective_score,
        'pre_status_active', pr.prov_pre_status_active,
        'all_fields_match', pb.all_provenance_fields_match,
        'content_md5_matches_baseline', pb.content_matches_preflight_baseline,
        'observation_matches_baseline', pb.observation_matches_preflight_baseline
      ) ORDER BY pb.loser_id)
      FROM prov_baseline pb JOIN prov pr ON pr.loser_id = pb.loser_id
    ),
    'all_four_preserved', (SELECT bool_and(pb.all_provenance_fields_match AND pb.content_matches_preflight_baseline AND pb.observation_matches_preflight_baseline) FROM prov_baseline pb)
  ),
  'F_canonical_behavior', jsonb_build_object(
    'content_unchanged', cn.content_unchanged_vs_baseline,
    'observation_unchanged', cn.observation_unchanged_vs_baseline,
    'times_used_unchanged_zero', cn.times_used = 0,
    'last_used_is_pool_max', cn.last_used_is_pool_max,
    'updated_at_bumped', cn.updated_at_bumped,
    'effective_score_matches_contract_formula', cn.effective_score_matches_contract_formula,
    'effective_score_value', cn.effective_score,
    'event_pre_snapshot_ok', cn.event_pre_times_used_ok AND cn.event_pre_last_used_ok AND cn.event_pre_effective_score_ok,
    'event_role_canonical', cn.event_role_canonical,
    'event_merged_ids_ok', cn.event_merged_ids_ok
  ),
  'G_retrieval_verification', jsonb_build_object(
    'embedding_available', rc.canonical_embedding_available,
    'candidates_returned', rc.candidates_returned,
    'canonical_retrievable', rc.canonical_retrievable,
    'losers_returned_count', rc.losers_returned_count,
    'losers_excluded', rc.losers_returned_count = 0,
    'retrieval_list', rc.retrieval_list
  ),
  'H_safety_verification', jsonb_build_object(
    'total_memories_before', 50, 'total_memories_after', sf.total_memories_after, 'no_hard_deletes', sf.total_memories_after = 50,
    'total_edges_before', 0,   'total_edges_after', sf.total_edges_after,     'edge_delta_exactly_plus_4', sf.total_edges_after = 4,
    'total_events_before', 8,  'total_events_after', sf.total_events_after,    'event_delta_exactly_plus_5', sf.total_events_after = 13,
    'unrelated_memory_mutations', sf.unrelated_memory_mutations,
    'unexpected_edges', sf.unexpected_edges,
    'no_unrelated_changes', sf.total_memories_after = 50 AND sf.total_edges_after = 4 AND sf.total_events_after = 13 AND sf.unrelated_memory_mutations = 0 AND sf.unexpected_edges = 0
  )
) AS final_report
FROM mem_state ms, edge_check ec, event_check ev, canon cn, retrieval_check rc, safety sf;






