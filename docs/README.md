# docs/

Design notes, audits and guides. The repo overview is `README.md` at the repo root; the plan is `ROADMAP.md`; the code's own file headers
(for example `packages/ui/shortcuts.js`) are the source of truth when a note here disagrees.

## Current notes and audits (this folder)

- `docs/DESIGN-PARITY.md` : the Design tab's parity audit across the four apps.
- `docs/DOCUMENT-TABS-DESIGN.md` : several designs open at once (document tabs).
- `docs/OPERATIONS-MODEL.md`, `docs/PARAMETERS-DESIGN.md` : design proposals (operations palette; parameter table).
- `docs/ORIGIN-RULES.md` : GENERATED index of the Shaper Origin rules (`node scripts/gen-origin-rules-index.mjs`); never edit by hand.
- `docs/CONSTRAINT-AUDIT.md`, `docs/COVERAGE-AUDIT.md`, `docs/FUSION-COMPARISON.md` : solver audits (rerun with the scripts in `scripts/README.md`).
- `docs/TEST-SORT.md` : which browser tests only check logic.
- `docs/tasks/` : the written task briefs.

## Guides from the first single-app era

These were written when the app was one page with a top-level source folder (it is gone: the code is now in `apps/`, `packages/core/` and
`packages/ui/`). They have NOT been re-checked against today's layout; read them for ideas and vocabulary, and trust the code.

- `docs/architecture/` : `docs/architecture/APP_MAP.md`, `docs/architecture/EXPORT_GUIDE.md`, `docs/architecture/EXPORT_HANDLING_GUIDE.md`, `docs/architecture/SKETCH STUDIO TERMINOLOGY.md`, `docs/architecture/SOLVER_WALKTHROUGH.md`,
  `docs/architecture/UI_SHELL.md` (the shared dock-panel design, closest to current).
- `docs/features/` : `docs/features/sketch guide.md`, `docs/features/constraints.md`.
- `docs/development/` : `docs/development/PERFORMANCE_ANALYSIS.md`, `docs/development/REFACTORING_UPDATE_LOG.md`, `docs/development/solver categories.md`.
- `docs/ai/` : older notes for AI agents; the current rules are in `AGENTS.md`.
- `docs/archive/` : `docs/archive/cad dev tech guide.md`.
