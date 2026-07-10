// CRC-32 (IEEE 802.3 polynomial). Required by every ZIP entry.
// Table is built lazily on first call.

let _table = null;
function buildTable() {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[i] = c >>> 0;
    }
    return t;
}

export function crc32(bytes) {
    if (!_table) _table = buildTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = _table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}
