// TASK 558: Ctrl+S (unsaved -> Save as prompt; named -> write now) and the leave-page warning, in sketchstudio (tests/save-key-leave-runner.js).
import { runSaveKeyLeave } from './save-key-leave-runner.js';
await runSaveKeyLeave({ host: 'sketchstudio' });
