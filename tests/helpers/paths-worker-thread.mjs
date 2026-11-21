// tests/helpers/paths-worker-thread.mjs — TASK 817: a node worker thread that runs the page's paths worker (apps/shaper/src/paths-worker.js) UNCHANGED. A Web Worker's
// script talks through `self` (self.onmessage, self.postMessage); a node worker thread through `parentPort`: this file gives the script that `self` (the only
// difference) and then imports it, so the node tests drive the very file the page starts, in a thread of its own, with the real structured clone between them.
import { parentPort } from 'node:worker_threads';

const self = { onmessage: null, postMessage: (msg) => parentPort.postMessage(msg) };
globalThis.self = self;
parentPort.on('message', (data) => { if (self.onmessage) self.onmessage({ data }); });
await import('../../apps/shaper/src/paths-worker.js');
