// TASK 558: the unsaved-design question, sketchstudio, answer "cancel", every entry path (tests/unsaved-prompt-runner.js).
// TASK 587: SketchStudio has document tabs: Open / Open recent / Open from file / New open a NEW TAB (nothing is replaced, so nothing asks; tests/document-tabs-ui-node.test.js). Leaving the page (GO TO) still asks.
import { runUnsavedPrompt } from './unsaved-prompt-runner.js';
await runUnsavedPrompt({ host: 'sketchstudio', choice: 'cancel', paths: ['goto'] });
