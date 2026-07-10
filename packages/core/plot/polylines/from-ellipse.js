// Sample an ellipse as a closed polyline. 96 segments matches the
// fidelity we use elsewhere (fill, simulation).
const SEGMENTS = 96;

export function fromEllipse(s) {
    const out = [];
    for (let i = 0; i <= SEGMENTS; i++) {
        const t = (i / SEGMENTS) * Math.PI * 2;
        out.push([s.cx + Math.cos(t) * s.rx, s.cy + Math.sin(t) * s.ry]);
    }
    return out;
}
