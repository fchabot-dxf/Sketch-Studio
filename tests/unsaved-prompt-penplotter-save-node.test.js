// TASK 583: the unsaved-design question, penplotter, answer "save", every entry path (tests/unsaved-prompt-node-runner.js; the node port of tests/unsaved-prompt-live-penplotter-save.test.js, TASK 558).
import { runUnsavedPrompt } from './unsaved-prompt-node-runner.js';
await runUnsavedPrompt({ host: 'penplotter', choice: 'save' });
