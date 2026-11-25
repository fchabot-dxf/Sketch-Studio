// tests/helpers/mesh-writers.js — TASK 897: write a flat triangle list (tests/helpers/stl-mesh.js: 9 numbers per triangle) as an OBJ text or a 3MF package, so
// the SAME triangles reach Shaper as STL, OBJ and 3MF. Every coordinate is written as its float32 value (Math.fround), the shortest text that reads back to it:
// the loaders' Float32 attributes then hold exactly the numbers a binary STL of the same triangles holds. One vertex per triangle corner (no sharing).
// `objects`: the triangles split into that many objects (OBJ `o`, 3MF objects each a build item), in order.
import { zipSync, strToU8 } from '../../packages/ui/vendor/three/addons/libs/fflate.module.js';

const f = (v) => String(Math.fround(v));
const chunks = (tris, objects) => {
  const n = tris.length / 9, per = Math.ceil(n / objects), out = [];
  for (let i = 0; i < n; i += per) out.push(tris.slice(9 * i, 9 * Math.min(n, i + per)));
  return out;
};

/** The triangles as an OBJ file's text (`v` / `f` lines; 1-based indices). */
export function objText(tris, { objects = 1 } = {}) {
  const lines = ['# OBJ written by the TASK 897 test'];
  let base = 0;
  chunks(tris, objects).forEach((part, k) => {
    if (objects > 1) lines.push(`o part${k + 1}`);
    for (let i = 0; i < part.length; i += 3) lines.push(`v ${f(part[i])} ${f(part[i + 1])} ${f(part[i + 2])}`);
    for (let t = 0; t < part.length / 9; t++) lines.push(`f ${base + 3 * t + 1} ${base + 3 * t + 2} ${base + 3 * t + 3}`);
    base += part.length / 3;
  });
  return lines.join('\n') + '\n';
}

/** The triangles as a 3MF package (a zip: content types, the root relationship, one model part declaring `unit`). */
export function threeMfBytes(tris, { unit = 'millimeter', objects = 1 } = {}) {
  const parts = chunks(tris, objects);
  const obj = parts.map((part, k) => {
    const vs = [], ts = [];
    for (let i = 0; i < part.length; i += 3) vs.push(`<vertex x="${f(part[i])}" y="${f(part[i + 1])}" z="${f(part[i + 2])}"/>`);
    for (let t = 0; t < part.length / 9; t++) ts.push(`<triangle v1="${3 * t}" v2="${3 * t + 1}" v3="${3 * t + 2}"/>`);
    return `<object id="${k + 1}" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`
    + `<resources>${obj.join('')}</resources><build>${parts.map((_, k) => `<item objectid="${k + 1}"/>`).join('')}</build></model>\n`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n'),
    '3D/3dmodel.model': strToU8(model),
  }, { mtime: new Date('2026-11-25T00:00:00Z') });
}
