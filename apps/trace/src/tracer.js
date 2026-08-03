/**
 * tracer.js
 * Wraps the ImageTracer worker. 
 * Accepts image canvas + params, returns SVG string asynchronously via Web Worker.
 */

let worker = null;
let currentJobId = 0;
const pendingResolvers = new Map(); // jobId -> { resolve, reject }

function initWorker() {
  if (worker) return;
  worker = new Worker(new URL('./tracer-worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const { jobId, svgStr, error } = e.data;
    const resolver = pendingResolvers.get(jobId);
    if (!resolver) return; // Stale job or already resolved
    
    pendingResolvers.delete(jobId);
    
    // Only resolve if it's the most recent job the user requested!
    if (jobId === currentJobId) {
      if (error) resolver.reject(new Error(error));
      else resolver.resolve(svgStr);
    }
  };
}

/**
 * Trace image data with given params using a Web Worker.
 * Returns a Promise<string> of SVG markup.
 */
export function trace(imgData, params) {
  return new Promise((resolve, reject) => {
    try {
      initWorker();
      
      const jobId = ++currentJobId;
      
      // Reject any previous pending jobs so they don't leak awaits in app.js
      for (const [id, res] of pendingResolvers.entries()) {
         res.reject(new Error('CANCELLED'));
      }
      pendingResolvers.clear();

      pendingResolvers.set(jobId, { resolve, reject });
      
      worker.postMessage({ jobId, imageData: imgData, params });
    } catch (err) {
      reject(err);
    }
  });
}
