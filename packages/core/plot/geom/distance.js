// Euclidean distance between two 2D points.
export function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Squared distance — faster when only used for comparisons.
export function distSq(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
}
