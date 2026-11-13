// TASK 558: the unsaved-design question, penplotter, answer "cancel", every entry path (tests/unsaved-prompt-runner.js).
import { runUnsavedPrompt } from './unsaved-prompt-runner.js';
await runUnsavedPrompt({ host: 'penplotter', choice: 'cancel' });
