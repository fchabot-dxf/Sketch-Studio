// Emit G-code for a single polyline via the machine profile (default DDCS):
//   G0 rapid to start (pen up) -> G1 Z plunge -> G1 draw lines -> G1 Z lift.
// Coordinates use 3-decimal mm; Y is flipped so SVG (Y-down) maps to machine (Y-up). Byte-identical to the
// pre-factoring emitter — only the machine-specific strings moved into profiles.js.
import { DDCS } from "./profiles.js";

export function pathBlock(points, settings, profile = DDCS) {
    if (!points || points.length < 2) return "";
    const { flipY, docH } = settings;
    const y = flipY ? (v) => (docH - v) : (v) => v;
    const lines = [];
    const [x0, y0] = points[0];
    lines.push(profile.rapidTo(x0, y(y0)));
    lines.push(profile.penDown(settings));
    for (const pt of points.slice(1)) {
        lines.push(profile.drawTo(pt[0], y(pt[1]), settings));
    }
    lines.push(profile.penUp(settings));
    return lines.join("\n") + "\n";
}
