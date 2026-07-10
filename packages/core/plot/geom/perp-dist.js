// Perpendicular distance from point `p` to the line segment a–b.
// Used by Douglas–Peucker simplification.
export function perpDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const denom = Math.hypot(dx, dy);
    if (denom === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    // Cross-product magnitude / segment length = perpendicular distance.
    const cross = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]);
    return cross / denom;
}
