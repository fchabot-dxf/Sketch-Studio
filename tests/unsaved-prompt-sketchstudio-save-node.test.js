// TASK 583: the unsaved-design question, sketchstudio, answer "save", every entry path (tests/unsaved-prompt-node-runner.js; the node port of tests/unsaved-prompt-live-sketchstudio-save.test.js, TASK 558).
import { runUnsavedPrompt } from './unsaved-prompt-node-runner.js';
await runUnsavedPrompt({ host: 'sketchstudio', choice: 'save' });
