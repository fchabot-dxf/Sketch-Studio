// apps/trace/src/tracer-worker.js
// Runs the heavy image-processing and vectorization in the background

importScripts('https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js');

function buildOptions(params) {
  const { threshold, blur, colorMode, simplify = 0, smooth = 0 } = params;
  const ltres = 1 + (smooth * smooth * 0.5);
  const qtres = 1 + (smooth * smooth * 0.5);
  const pathomit = 8 + (simplify * simplify * 50);

  if (colorMode === 'bw') {
    return {
      numberofcolors: 2,
      mincolorratio:  0,
      colorquantcycles: 1,
      blurradius:     blur,
      blurdelta:      20,
      ltres:          ltres,
      qtres:          qtres,
      pathomit:       pathomit,
      rightangleenhance: true,
      colorsampling: 0,
      palette: [
        { r: 0,   g: 0,   b: 0,   a: 255 },
        { r: 255, g: 255, b: 255, a: 0   },
      ],
    };
  }

  return {
    numberofcolors: 16,
    mincolorratio:  0.02,
    colorquantcycles: 3,
    blurradius:     blur,
    blurdelta:      20,
    ltres:          ltres,
    qtres:          qtres,
    pathomit:       pathomit,
    rightangleenhance: true,
    colorsampling: 2,
  };
}

function applyThreshold(imgData, threshold) {
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    const v   = lum < threshold ? 0 : 255;
    data[i]   = v;
    data[i+1] = v;
    data[i+2] = v;
    data[i+3] = 255;
  }
}

function applyOutlineOnly(imgData) {
  const w = imgData.width;
  const h = imgData.height;
  const data = imgData.data;
  const stack = [];
  
  for (let x = 0; x < w; x++) { stack.push(x, 0); stack.push(x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y); stack.push(w - 1, y); }

  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    
    const idx = (y * w + x) * 4;
    if (data[idx] === 255) {
      data[idx] = 128;
      stack.push(x + 1, y);
      stack.push(x - 1, y);
      stack.push(x, y + 1);
      stack.push(x, y - 1);
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 128) {
      data[i]   = 255;
      data[i+1] = 255;
      data[i+2] = 255;
    } else if (data[i] === 255) {
      data[i]   = 0;
      data[i+1] = 0;
      data[i+2] = 0;
    }
  }
}

self.onmessage = function(e) {
  const { jobId, imageData, params } = e.data;
  
  try {
    if (params.colorMode === 'bw') {
      applyThreshold(imageData, params.threshold);
      if (params.outlineOnly) {
        applyOutlineOnly(imageData);
      }
    }
    const options = buildOptions(params);
    let svgStr = self.ImageTracer.imagedataToSVG(imageData, options);
    
    // ImageTracer often omits the viewBox attribute, which prevents CSS scaling.
    // We inject it based on the width/height attributes it outputs.
    if (!svgStr.includes('viewBox')) {
      svgStr = svgStr.replace(/<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/, (match, w, h) => {
        return match + ` viewBox="0 0 ${w} ${h}"`;
      });
    }

    self.postMessage({ jobId, svgStr });
  } catch (err) {
    self.postMessage({ jobId, error: err.message });
  }
};
