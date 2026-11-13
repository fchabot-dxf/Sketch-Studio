// TASK 583: the unsaved-design question, penplotter, answer "discard", every entry path (tests/unsaved-prompt-node-runner.js; the node port of tests/unsaved-prompt-live-penplotter-discard.test.js, TASK 558).
import { runUnsavedPrompt } from './unsaved-prompt-node-runner.js';
await runUnsavedPrompt({ host: 'penplotter', choice: 'discard' });
