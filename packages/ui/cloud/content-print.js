// packages/ui/cloud/content-print.js — THE fingerprint that tells "Drive's copy is ours" (TASK 766; moved here unchanged from project-store.js in TASK 773 so
// the settings sync uses the same rule as the design writer, not a copy of it).
/** The fingerprint of content as Drive stores it (the JSON of a design's document, or the text of the settings file): a 53-bit hash (cyrb53) of its JSON,
 *  so the meta stays small. A document read back from Drive gives the same text as the one written, so the same print. */
export function contentPrint(document) {
  const str = JSON.stringify(document === undefined ? null : document);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
