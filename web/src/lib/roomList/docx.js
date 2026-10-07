// Word (.docx) rooming lists: the tables in the document, read into grids,
// and written back with only the text inside the name boxes changed - the
// table borders, shading, fonts and everything around the tables stay
// exactly as they were imported.
import JSZip from 'jszip';
import { attr, descendants, kid, kids, make, parseXml, serializeXml, XML_NS } from './xml';

async function mainPart(zip) {
  const rels = zip.file('_rels/.rels');
  if (rels) {
    const doc = parseXml(await rels.async('string'));
    const main = descendants(doc.documentElement, 'Relationship')
      .find((r) => /\/officeDocument$/.test(attr(r, 'Type') || ''));
    if (main) {
      const target = String(attr(main, 'Target') || '').replace(/^\//, '');
      if (zip.file(target)) return target;
    }
  }
  return zip.file('word/document.xml') ? 'word/document.xml' : null;
}

// The words in a paragraph as they read: tabs and line breaks kept, deleted
// (tracked) text and field codes left out.
function paragraphText(p) {
  let out = '';
  const walk = (el) => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const name = n.localName;
      if (name === 't') out += n.textContent;
      else if (name === 'tab') out += '\t';
      else if (name === 'br' || name === 'cr') out += '\n';
      else if (name === 'del' || name === 'delText' || name === 'instrText' || name === 'tbl') continue;
      else walk(n);
    }
  };
  walk(p);
  return out;
}

const cellText = (tc) => kids(tc, 'p').map(paragraphText).join('\n').trim();

function tablesOf(doc) {
  const body = descendants(doc.documentElement, 'body')[0];
  const out = [];
  let lastText = '';
  kids(body).forEach((n) => {
    if (n.localName === 'p') {
      const t = paragraphText(n).trim();
      if (t) lastText = t;
    } else if (n.localName === 'tbl') {
      out.push({ tbl: n, before: lastText });
    }
  });
  return out;
}

const valOf = (el) => Number(attr(el, 'val')) || 0;

/** Every top-level table in the document, as a grid. */
export async function readDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const part = await mainPart(zip);
  if (!part) throw new Error('That file is not a Word document.');
  const doc = parseXml(await zip.file(part).async('string'));

  return tablesOf(doc).map(({ tbl, before }, t) => {
    const cells = new Map();
    const merges = [];
    const openDown = new Map(); // column -> the merge a vertical box started
    let cols = 0;
    const trs = kids(tbl, 'tr');
    trs.forEach((tr, r) => {
      const trPr = kid(tr, 'trPr');
      let c = trPr ? valOf(kid(trPr, 'gridBefore')) : 0;
      kids(tr, 'tc').forEach((tc, i) => {
        const tcPr = kid(tc, 'tcPr');
        const span = Math.max(1, tcPr ? valOf(kid(tcPr, 'gridSpan')) || 1 : 1);
        const vMerge = tcPr ? kid(tcPr, 'vMerge') : null;
        const continues = vMerge && attr(vMerge, 'val') !== 'restart';
        if (continues && openDown.has(c)) {
          openDown.get(c).r2 = r;
        } else {
          cells.set(`${r},${c}`, { r, c, text: cellText(tc), ref: { t, row: r, cell: i }, formula: false });
          const m = { r1: r, c1: c, r2: r, c2: c + span - 1 };
          if (span > 1 || vMerge) merges.push(m);
          if (vMerge) openDown.set(c, m);
          else openDown.delete(c);
        }
        c += span;
      });
      cols = Math.max(cols, c);
    });
    return { key: `t${t}`, label: `Table ${t + 1}`, title: before, cells, merges, rows: trs.length, cols };
  });
}

function setCellText(doc, tc, text) {
  const ps = kids(tc, 'p');
  let p = ps[0];
  if (!p) {
    p = make(doc, tc, 'p');
    tc.appendChild(p);
  }
  ps.slice(1).forEach((x) => tc.removeChild(x));

  // The look of the words already in the box: the first run's properties, or
  // the paragraph's own when the box was empty.
  const pPr = kid(p, 'pPr');
  const firstRun = descendants(p, 'r')[0];
  const look = (firstRun && kid(firstRun, 'rPr')) || (pPr && kid(pPr, 'rPr'));

  kids(p).forEach((n) => { if (n.localName !== 'pPr') p.removeChild(n); });
  if (!text) return;

  const r = make(doc, p, 'r');
  if (look) r.appendChild(look.cloneNode(true));
  String(text).split('\n').forEach((line, i) => {
    if (i) r.appendChild(make(doc, p, 'br'));
    const t = make(doc, p, 't');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.appendChild(doc.createTextNode(line));
    r.appendChild(t);
  });
  p.appendChild(r);
}

/**
 * The document, with these boxes holding these names.
 *
 * @param {Array<{ref: {t, row, cell}, text}>} writes
 */
export async function fillDocx(buffer, writes) {
  const zip = await JSZip.loadAsync(buffer);
  const part = await mainPart(zip);
  const doc = parseXml(await zip.file(part).async('string'));
  const tables = tablesOf(doc);
  writes.forEach((w) => {
    const tbl = tables[w.ref?.t]?.tbl;
    const tr = tbl ? kids(tbl, 'tr')[w.ref.row] : null;
    const tc = tr ? kids(tr, 'tc')[w.ref.cell] : null;
    if (tc) setCellText(doc, tc, w.text);
  });
  zip.file(part, serializeXml(doc), { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
