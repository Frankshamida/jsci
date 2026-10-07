// The few XML helpers the Excel and Word readers share. Matched on local
// names, so a file written with a prefix ("x:row") or the Strict namespace
// reads the same as one written the usual way.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export function parseXml(text) {
  return new DOMParser().parseFromString(text, 'text/xml');
}

/** Back to text, with the declaration Office expects at the top. */
export function serializeXml(doc) {
  const out = new XMLSerializer().serializeToString(doc);
  return out.startsWith('<?xml') ? out : DECL + out;
}

/** The element children of el called name. */
export function kids(el, name) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || n.localName === name)) out.push(n);
  }
  return out;
}

export const kid = (el, name) => kids(el, name)[0] || null;

/** Every element under el called name, in document order. */
export function descendants(el, name, out = []) {
  for (let n = el?.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    if (n.localName === name) out.push(n);
    descendants(n, name, out);
  }
  return out;
}

/** A new element in the same namespace, and with the same prefix, as like. */
export function make(doc, like, name) {
  return doc.createElementNS(like.namespaceURI, like.prefix ? `${like.prefix}:${name}` : name);
}

/** An attribute by its local name, whatever its prefix. */
export function attr(el, name) {
  if (!el?.attributes) return null;
  for (let i = 0; i < el.attributes.length; i += 1) {
    const a = el.attributes[i];
    if (a.localName === name || a.name === name) return a.value;
  }
  return null;
}
