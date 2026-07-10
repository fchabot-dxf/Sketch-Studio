// A line shape becomes a two-point polyline.
export function fromLine(s) {
    return [[s.x1, s.y1], [s.x2, s.y2]];
}
