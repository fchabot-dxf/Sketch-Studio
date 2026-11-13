// TASK 583: Ctrl+S (unsaved -> Save as prompt; named -> write now) and the leave-page warning's logic, sketchstudio (tests/save-key-leave-node-runner.js; the node port of tests/save-key-leave-live-sketchstudio.test.js, TASK 558).
import { runSaveKeyLeave } from './save-key-leave-node-runner.js';
await runSaveKeyLeave({ host: 'sketchstudio' });
