# AETHER MASTER ENGINEERING PLAN

**Status as of 2026-09-28 (end of Step 8):** Phases 1-5 are implemented and
covered by the regression suite; the MVP capability set is verified end to end
through the real authenticated `/api/chat` path. Phases 6-10 are not started and
are out of MVP scope. See `docs/CURRENT_STATE.md` for the verification evidence
and `docs/ACCEPTANCE_TESTS.md` for the acceptance record.

## Vision

Build Aether as an AI operating system with persistent human-like memory.

---

# Engineering Rules

- Never break production.
- Every milestone must build successfully.
- Every milestone must pass lint.
- Never create duplicate systems.
- Extend existing architecture.
- One milestone per implementation session.

---

# Milestones

## Phase 0
Foundation
Status: ✅ Complete

---

## Phase 1
Memory Foundation

Status:
✅ Complete

Goals

- Memory schema
- Shared types
- Scoring
- Constants
- Database versioning

---

## Phase 2
Retriever

Status:
✅ Complete

Goals

- Hybrid retrieval
- Vector search
- Keyword search
- Reranking
- Token budgeting

---

## Phase 3
Memory Writer

Status:
✅ Complete

Goals

- Extraction
- Classification
- Deduplication
- Embeddings
- Persistence

---

## Phase 4
Reflection Engine

Status:
✅ Complete

Goals

- Reflection
- Consolidation
- Forgetting
- Memory lifecycle

---

## Phase 5
Identity Engine

Status:
✅ Complete

Goals

- Identity facts
- Preferences
- User profile
- Confidence updates

---

## Phase 6
Knowledge Engine

Status:
⏸ Not started (non-MVP)

Goals

- Personal knowledge
- External knowledge
- Search
- Imports

---

## Phase 7
Planner

Goals

- Goals
- Projects
- Tasks
- Milestones

---

## Phase 8
Brain

Goals

- Prompt Builder
- Context Builder
- Layered Memory
- Working Memory

---

## Phase 9
Copilot

Goals

- Proactive AI
- Suggestions
- Predictions
- Daily planning

---

## Phase 10
Production

Goals

- Performance
- Monitoring
- Security
- Scaling
- Release