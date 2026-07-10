// STORE-method (no compression) ZIP builder for the browser. Tiny and
// dependency-free — sufficient for plain-text G-code, which doesn't
// compress dramatically anyway. Output is a Blob ready for download.

import { crc32 } from "./crc32.js";

const ENCODER = new TextEncoder();

function dosTime(date) {
    return ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
}
function dosDate(date) {
    return (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
}

function le16(v, dv, off) { dv.setUint16(off, v, true); }
function le32(v, dv, off) { dv.setUint32(off, v, true); }

/**
 * Build a STORE-method ZIP from an array of { name, content } entries.
 * `content` may be a string or Uint8Array.
 */
export function buildZip(entries) {
    const now = new Date();
    const time = dosTime(now);
    const date = dosDate(now);

    const local = [];      // local file header + data chunks
    const central = [];    // central directory entries
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = ENCODER.encode(entry.name);
        const data = typeof entry.content === "string"
            ? ENCODER.encode(entry.content)
            : entry.content;
        const c = crc32(data);

        // Local file header (30 bytes + name + data)
        const lh = new Uint8Array(30 + nameBytes.length);
        const ldv = new DataView(lh.buffer);
        le32(0x04034b50, ldv, 0);        // signature
        le16(20, ldv, 4);                // version needed
        le16(0, ldv, 6);                 // flags
        le16(0, ldv, 8);                 // method (0 = STORE)
        le16(time, ldv, 10);
        le16(date, ldv, 12);
        le32(c, ldv, 14);                // CRC-32
        le32(data.length, ldv, 18);      // compressed size = uncompressed (STORE)
        le32(data.length, ldv, 22);
        le16(nameBytes.length, ldv, 26);
        le16(0, ldv, 28);                // extra length
        lh.set(nameBytes, 30);
        local.push(lh, data);

        // Central directory entry (46 bytes + name)
        const ch = new Uint8Array(46 + nameBytes.length);
        const cdv = new DataView(ch.buffer);
        le32(0x02014b50, cdv, 0);
        le16(20, cdv, 4);
        le16(20, cdv, 6);
        le16(0, cdv, 8);
        le16(0, cdv, 10);
        le16(time, cdv, 12);
        le16(date, cdv, 14);
        le32(c, cdv, 16);
        le32(data.length, cdv, 20);
        le32(data.length, cdv, 24);
        le16(nameBytes.length, cdv, 28);
        le16(0, cdv, 30);                // extra
        le16(0, cdv, 32);                // comment
        le16(0, cdv, 34);                // disk
        le16(0, cdv, 36);                // internal attrs
        le32(0, cdv, 38);                // external attrs
        le32(offset, cdv, 42);           // offset of local header
        ch.set(nameBytes, 46);
        central.push(ch);

        offset += lh.length + data.length;
    }

    // Build central directory blob to know its size.
    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    // End of central directory record (22 bytes)
    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    le32(0x06054b50, edv, 0);
    le16(0, edv, 4);                     // disk
    le16(0, edv, 6);                     // disk with central dir
    le16(entries.length, edv, 8);
    le16(entries.length, edv, 10);
    le32(centralSize, edv, 12);
    le32(offset, edv, 16);               // central dir offset
    le16(0, edv, 20);                    // comment length

    return new Blob([...local, ...central, eocd], { type: "application/zip" });
}
