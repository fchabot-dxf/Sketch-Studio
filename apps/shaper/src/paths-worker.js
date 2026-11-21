// apps/shaper/src/paths-worker.js — TASK 817: the BACKGROUND worker that generates the operations' paths (and the Shaper file) while the page stays usable. It is
// only the transport: every job is served by op-derive.js createPathsServer, the same code the main thread's in-process port (op-paths.js localPort) and the node
// tests run, on the #core derivation modules (no second implementation). Started by main.js as a MODULE worker (op-paths.js workerPort).
import { createPathsServer } from './op-derive.js';

const server = createPathsServer({ post: (msg) => self.postMessage(msg), schedule: (fn) => setTimeout(fn, 0) });
self.onmessage = (e) => server.receive(e.data);
