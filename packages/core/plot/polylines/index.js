// Dispatch any shape type to the right flattener. Returns null when the
// shape isn't representable as a polyline.

import { fromLine } from "./from-line.js";
import { fromRect } from "./from-rect.js";
import { fromEllipse } from "./from-ellipse.js";
import { fromPolyline } from "./from-polyline.js";
import { fromPath } from "./from-path.js";

export function shapeToPolyline(s) {
    switch (s.type) {
        case "line":     return fromLine(s);
        case "rect":     return fromRect(s);
        case "ellipse":  return fromEllipse(s);
        case "polyline": return fromPolyline(s);
        case "path":     return fromPath(s);
    }
    return null;
}
