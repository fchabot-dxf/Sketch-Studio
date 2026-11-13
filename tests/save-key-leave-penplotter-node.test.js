// TASK 583: Ctrl+S (unsaved -> Save as prompt; named -> write now) and the leave-page warning's logic, penplotter (tests/save-key-leave-node-runner.js; the node port of tests/save-key-leave-live-penplotter.test.js, TASK 558).
import { runSaveKeyLeave } from './save-key-leave-node-runner.js';
await runSaveKeyLeave({ host: 'penplotter' });
