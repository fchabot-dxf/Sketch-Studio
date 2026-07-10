// A rect becomes a closed 5-point polyline (last point == first).
export function fromRect(s) {
    return [
        [s.x, s.y],
        [s.x + s.w, s.y],
        [s.x + s.w, s.y + s.h],
        [s.x, s.y + s.h],
        [s.x, s.y],
    ];
}
