# World Model - Foundation Design (Priority 6, step 1)

**Status:** Foundation only. `lib/agent/world/` exists, is flag-gated by
`ENABLE_WORLD_MODEL` (default OFF), and deterministically builds bounded state
snapshots, predicts simple effects of candidate actions, and proposes state
updates from observations. It writes nothing, reads nothing, calls no
provider, and is imported by no production file.

**Related:** `docs/AGENT_LOOP_DESIGN.md`, `docs/FEATURE_FLAGS.md`,
`docs/CONTINUAL_LEARNING_DESIGN.md`, `lib/config/features.ts`,
`lib/memory/types.ts`, `lib/planner/types.ts`.

## 1. Purpose and guardrails

A small, structured belief state about what the product knows - entities,
relations, predicted effects of candidate actions, and what an observation
implies - without touching the live product.

1. The single-call chat path stays the default and byte-for-byte identical
   with the flag OFF.
2. The flag defaults to OFF and fails closed (`docs/FEATURE_FLAGS.md`).
3. No change to `lib/core/pipeline.ts`, `app/api/chat/route.ts`,
   `lib/agent/loop.ts`, `lib/agent/runner.ts`, `lib/memory/*`, any repository,
   any migration, or any provider file. Nothing is wired yet.
4. No database migration: no column, no table, no RPC, no write.
5. Every function never throws and degrades to a content-free deferral or an
   empty result, matching the sibling foundations.
6. Deterministic first: no model call anywhere in the skeleton. Identical
   input always yields identical output.

## 2. What already exists and is reused

Confirmed by reading the current source. Nothing below was modified.

| Existing piece | Location | How the world model reuses it |
| --- | --- | --- |
| Memory record + type/status vocabulary | `MemoryRecord`, `MemoryType`, `MemoryStatus`, `lib/memory/types.ts` | Entity `kind` reuses the eight memory types verbatim (type-only import); snapshot eligibility reuses stored statuses (active/candidate/fading; archived/deleted/merged stay out of the world). |
| Confidence / correction magnitudes | `CONFIDENCE_CORRECTION_STEP`, `CONFIDENCE_CORROBORATION_STEP`, `DEFAULT_CONFIDENCE`, `lib/memory/constants.ts:47-53` | Reinforcement and confirmed/contradicted deltas reuse the exact steps the learning foundation reuses; defaults reuse `DEFAULT_CONFIDENCE` (0.5). No new tuning value. |
| Identity / memory row reads | `lib/memory/identity.ts`, `lib/repositories/memory.repository.ts` | Read *only* by a future wiring step: the skeleton takes caller-supplied rows and never touches these itself. |
| Planner state | `Goal`, `Task`, `lib/planner/types.ts`; `lib/repositories/planner.repository.ts` | Goals and tasks project into `goal` / `task` entities; again the skeleton accepts caller-supplied rows only. |
| Agent trace / tool outcomes | `AgentTraceStep`, `lib/agent/types.ts:38-50`; recorded at `lib/agent/loop.ts:284-288` | The natural future input for entity-confirming observations; the trace is already content-free, which is what `WorldObservation` requires (ids only). |
| Procedural memory | `lib/agent/procedural/*` | A `procedural` memory row simply becomes a `procedural` entity; the extraction path is untouched. |
| Continual-learning signals | `lib/agent/learning/*` | Same proposal discipline (`requiresWrite: true` until a writer exists), same deterministic-rule style, same flag/deferral ladder. A future step can map correction signals into `WorldObservation.contradictedEntityIds`. |
| Feature-flag reader | `lib/config/features.ts` | One additive flag entry, default OFF, fail-closed. |

## 3. Files (all additive)

| File | Responsibility |
| --- | --- |
| `lib/agent/world/types.ts` | `WorldEntity`, `WorldRelation`, `WorldState`, `PredictedEffect`, `WorldUpdate`, `WorldObservation`, `CandidateAction`, `WorldRequest`, `WorldModelOutcome`. Type-only import; no runtime code. |
| `lib/agent/world/constants.ts` | Bounds (`MAX_WORLD_ENTITIES=50`, `MAX_WORLD_RELATIONS=100`, `MAX_WORLD_UPDATES=50`, label/id/asOf caps), `WORLD_PREDICT_CONFIDENCE`, `WORLD_RELATION_KINDS`, defensive helpers. |
| `lib/agent/world/snapshot.ts` | `buildWorldState(request)` - pure projection of memories/goals/tasks/relations into a bounded `WorldState`. |
| `lib/agent/world/predict.ts` | `predictEffects(state, action)` - one deterministic prediction per action from a closed vocabulary. |
| `lib/agent/world/update.ts` | `proposeWorldUpdates(state, observation)` - bounded, content-free `WorldUpdate` proposals. |
| `lib/agent/world/index.ts` | `buildWorldModel(request, deps?)` entry point behind `ENABLE_WORLD_MODEL`; re-exports the whole surface. |

## 4. Entry point and deferral ladder

```ts
buildWorldModel(request, deps?): Promise<WorldModelOutcome>
```

1. `ENABLE_WORLD_MODEL` off or unreadable -> `{ kind: "deferred", reason: "world_disabled" }`
2. request not an object, or missing/blank/non-string `userId` -> `"invalid_request"`
3. otherwise -> `{ kind: "built", state, predictions, updates }`
   (`predictions` empty without an `action`, `updates` empty without an
   `observation`; a request with no inputs builds an empty-but-real snapshot
   rather than deferring, because "nothing is known yet" is still a state).

## 5. Rule summary (all unit tested)

- **Snapshot:** memory status active/candidate/fading -> active/candidate/uncertain;
  archived/deleted/merged/unknown excluded; missing status -> candidate;
  unknown memoryType -> semantic; goals -> active, tasks done -> uncertain;
  dedupe by id (first wins); entities capped at 50; labels trimmed/capped;
  relations only between known endpoints, no self-relations, kind defaults to
  `related_to`, deduped by `from|to|kind`, capped at 100.
- **Predict:** `add_entity` label match (case-insensitive) -> `entity_reinforced`
  (+0.05 corroboration step), else `entity_created` (delta 0); `update_entity`
  known -> reinforced, unknown target -> `no_state_change`, missing -> unknown;
  `add_relation` new -> `relation_added`, existing -> idempotent
  `no_state_change`, unknown endpoint/self -> `no_state_change`, invalid
  kind/missing ids -> unknown; anything outside the vocabulary -> a single
  `unknown` prediction; no action -> `[]`.
- **Update:** confirmed -> `entity_confirmed` (+0.05), contradicted ->
  `entity_contradicted` (-0.1 correction step), contradiction wins over
  confirmation; observed relations only for known, non-self, not-yet-believed
  pairs; unknown ids/duplicates skipped; order confirmed -> contradicted ->
  relations; capped at 50; every proposal carries `requiresWrite: true`.

## 6. Explicit non-goals for this step

- No database read/write, no repository call, no RPC, no migration.
- No provider call, no model inference, no tool call, no clock read.
- No change to `lib/memory/*`, `lib/core/pipeline.ts`, `lib/agent/loop.ts`,
  `lib/agent/runner.ts`, `app/api/chat/route.ts`, or any existing contract.
- No wiring: nothing imports `lib/agent/world/` in production, asserted by test.
- No persistence: where a `WorldState` lives between requests is a later
  decision. Cross-turn accumulation, decay, and entity merging are out of scope.

## 7. How to verify

```bash
npx tsc --noEmit
npx vitest run tests/unit/agent/world.test.ts tests/unit/agent/world-rules.test.ts tests/unit/agent/world-index.test.ts tests/unit/config/features.test.ts
npx eslint lib/agent/world tests/unit/agent/world*.test.ts
```

Production isolation is asserted directly: no file under `app/` or `lib/` that
the live path uses references `agent/world` or `ENABLE_WORLD_MODEL`, the world
modules statically import no repository/Supabase/provider/writer, and
`app/api/chat/route.ts` still answers through `preStreamPipeline` and
`getProvider`.

## 8. Next steps (not implemented, each separately reviewed)

1. A flag-gated read site that assembles a `WorldRequest` from rows a finished
   turn already fetched, and logs content-free counts.
2. Mapping continual-learning signals into `WorldObservation` (correction ->
   contradicted ids) so the Priority 5 and 6 foundations compose.
3. Prediction-aware planning: let the orchestration coordinator consult
   `predictEffects` before choosing an action.
4. A decision on where a `WorldState` lives between requests, before any
   writer exists.

