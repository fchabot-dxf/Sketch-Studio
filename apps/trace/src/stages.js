// apps/trace/src/stages.js — Trace's stage list, DECLARED in one importable place (TASK 707; the page script app.js and the node test both read it).
// Trace (image -> paths: Trace's own step) -> Design (the shared Design canvas; its stage id stays 'edit') -> Export. Trace has no per-shape output
// settings, so it declares no Prepare.
import { commonStage } from '#ui/stage-names.js';

export const TRACE_STAGES = [
  { id: 'trace', label: 'Trace' },
  commonStage('design', 'edit'),
  commonStage('export'),
];
