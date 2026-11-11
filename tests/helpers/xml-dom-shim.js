// tests/helpers/xml-dom-shim.js — a minimal DOMParser stand-in for Node (which has none): just enough of the DOM for
// the well-formed SVG sheets the glyph loader reads (element tree, attributes, children, tagName, getAttribute).
export const attributesRead = new Set(); // every attribute name the loader asked for (lets a test assert it never reads `transform`)

function parse(text) {
  const root = { tagName: 'root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g;
  const body = text.replace(/<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->/g, '');
  let m;
  while ((m = re.exec(body))) {
    const [, closing, tag, rest, selfClose] = m;
    if (closing) { stack.pop(); continue; }
    const attrs = {};
    for (const a of rest.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const el = { tagName: tag, attrs, children: [], getAttribute: (n) => { attributesRead.add(n); return n in attrs ? attrs[n] : null; } };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root.children[0];
}

export class DOMParserShim {
  parseFromString(text) {
    const documentElement = parse(text);
    return { documentElement, getElementsByTagName: () => [] };
  }
}
