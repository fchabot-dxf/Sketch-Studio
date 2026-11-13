// TASK 583: the unsaved-design question, sketchstudio, answer "cancel", every entry path (tests/unsaved-prompt-node-runner.js; the node port of tests/unsaved-prompt-live-sketchstudio-cancel.test.js, TASK 558).
import { runUnsavedPrompt } from './unsaved-prompt-node-runner.js';
await runUnsavedPrompt({ host: 'sketchstudio', choice: 'cancel' });
