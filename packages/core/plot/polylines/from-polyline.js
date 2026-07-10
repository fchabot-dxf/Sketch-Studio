// A polyline shape is already a list of points — just shallow-copy.
export function fromPolyline(s) {
    return s.points.map(p => [p[0], p[1]]);
}
