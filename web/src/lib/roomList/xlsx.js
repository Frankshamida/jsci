// Excel (.xlsx) rooming lists: read into grids, and written back.
//
// Written back by changing the text of the name boxes and NOTHING else. The
// workbook is not opened and re-saved by a library - that re-writes the
// styles, the theme and the print setup in the library's own idea of them,
// and the sheet that comes back is "the same data" in somebody else's
// design. Here every other byte of the file is the one that was imported:
// the fonts, the colours, the merged boxes, the column widths, the second
// sheet, the page setup.
import JSZip from 'jszip';
import { attr, descendants, kid, kids, make, parseXml, serializeXml, XML_NS } from './xml';

const colIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref || '').toUpperCase());
  return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null;
}

function resolvePart(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  target.split('/').forEach((p) => {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  });
  return parts.join('/');
}

// A number as somebody typed it: 204, not 204.00000000000003.
function numberText(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15)));
}

// The text of a shared or inline string, without the phonetic guide some
// East Asian sheets carry alongside it.
function stringText(si) {
  let out = '';
  kids(si).forEach((n) => {
    if (n.localName === 't') out += n.textContent;
    else if (n.localName === 'r') kids(n, 't').forEach((t) => { out += t.textContent; });
  });
  return out;
}

async function sheetsOf(zip) {
  const wbPath = 'xl/workbook.xml';
  const wb = parseXml(await zip.file(wbPath).async('string'));
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  const rels = relsFile ? parseXml(await relsFile.async('string')) : null;
  const targets = new Map();
  if (rels) {
    descendants(rels.documentElement, 'Relationship').forEach((r) => {
      if (/\/worksheet$/.test(attr(r, 'Type') || '')) targets.set(attr(r, 'Id'), resolvePart(wbPath, attr(r, 'Target')));
    });
  }
  return descendants(wb.documentElement, 'sheet')
    .filter((s) => !/hidden/i.test(attr(s, 'state') || ''))
    .map((s) => ({ name: attr(s, 'name') || 'Sheet', part: targets.get(attr(s, 'id')) }))
    .filter((s) => s.part && zip.file(s.part));
}

/** Every visible sheet of the workbook, as a grid. */
export async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file('xl/workbook.xml')) throw new Error('That file is not an Excel workbook.');

  const shared = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ss = parseXml(await ssFile.async('string'));
    kids(ss.documentElement, 'si').forEach((si) => shared.push(stringText(si)));
  }

  const grids = [];
  for (const sheet of await sheetsOf(zip)) {
    const doc = parseXml(await zip.file(sheet.part).async('string'));
    const cells = new Map();
    let rows = 0;
    let cols = 0;
    descendants(doc.documentElement, 'c').forEach((c) => {
      const at = parseRef(attr(c, 'r'));
      if (!at) return;
      const t = attr(c, 't');
      const v = kid(c, 'v');
      let text = '';
      if (t === 's' && v) text = shared[Number(v.textContent)] ?? '';
      else if (t === 'inlineStr') text = stringText(kid(c, 'is') || c);
      else if (t === 'b' && v) text = v.textContent === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'str' || t === 'e') text = v ? v.textContent : '';
      else if (v) text = numberText(v.textContent);
      cells.set(`${at.r},${at.c}`, { r: at.r, c: at.c, text: text.trim(), ref: attr(c, 'r'), formula: !!kid(c, 'f') });
      rows = Math.max(rows, at.r + 1);
      cols = Math.max(cols, at.c + 1);
    });
    const merges = descendants(doc.documentElement, 'mergeCell').map((m) => {
      const [from, to] = String(attr(m, 'ref') || '').split(':');
      const a = parseRef(from);
      const b = parseRef(to || from);
      return a && b ? { r1: a.r, c1: a.c, r2: b.r, c2: b.c } : null;
    }).filter(Boolean);
    merges.forEach((m) => { rows = Math.max(rows, m.r2 + 1); cols = Math.max(cols, m.c2 + 1); });
    grids.push({ key: sheet.part, label: sheet.name, cells, merges, rows, cols });
  }
  return grids;
}

// ---- Writing ----

function findRow(doc, sheetData, rowNum) {
  let before = null;
  for (const row of kids(sheetData, 'row')) {
    const n = Number(attr(row, 'r'));
    if (n === rowNum) return row;
    if (n > rowNum) { before = row; break; }
  }
  const like = kid(sheetData, 'row') || sheetData;
  const row = make(doc, like === sheetData ? sheetData : like, 'row');
  row.setAttribute('r', String(rowNum));
  sheetData.insertBefore(row, before);
  return row;
}

function findCell(doc, row, ref) {
  const want = parseRef(ref).c;
  let before = null;
  for (const c of kids(row, 'c')) {
    const at = parseRef(attr(c, 'r'));
    if (!at) continue;
    if (at.c === want) return c;
    if (at.c > want) { before = c; break; }
  }
  if (!before) before = kid(row, 'extLst');
  const cell = make(doc, row, 'c');
  cell.setAttribute('r', ref);
  // A new box takes the style of its row, if the row has one.
  const rowStyle = attr(row, 's');
  if (rowStyle && attr(row, 'customFormat') === '1') cell.setAttribute('s', rowStyle);
  row.insertBefore(cell, before);
  // spans is a hint about which columns a row uses; a box outside it would
  // make it wrong, so it goes.
  if (row.hasAttribute('spans')) row.removeAttribute('spans');
  return cell;
}

function setText(doc, cell, text) {
  kids(cell).forEach((n) => {
    if (n.localName === 'v' || n.localName === 'is' || n.localName === 'f') cell.removeChild(n);
  });
  if (!text) {
    cell.removeAttribute('t');
    return;
  }
  cell.setAttribute('t', 'inlineStr');
  const is = make(doc, cell, 'is');
  const t = make(doc, cell, 't');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  is.appendChild(t);
  cell.insertBefore(is, kid(cell, 'extLst'));
}

/**
 * The workbook, with these boxes holding these names and everything else as
 * it was.
 *
 * @param {Buffer} buffer the imported file
 * @param {Array<{grid: string, ref: string, text: string}>} writes grid is the sheet's part
 */
export async function fillXlsx(buffer, writes) {
  const zip = await JSZip.loadAsync(buffer);
  const byPart = new Map();
  writes.forEach((w) => {
    if (!w.ref || !parseRef(w.ref)) return;
    if (!byPart.has(w.grid)) byPart.set(w.grid, []);
    byPart.get(w.grid).push(w);
  });
  for (const [part, list] of byPart) {
    const file = zip.file(part);
    if (!file) continue;
    const doc = parseXml(await file.async('string'));
    const sheetData = descendants(doc.documentElement, 'sheetData')[0];
    if (!sheetData) continue;
    list.forEach((w) => {
      const row = findRow(doc, sheetData, parseRef(w.ref).r + 1);
      setText(doc, findCell(doc, row, w.ref.toUpperCase()), w.text);
    });
    zip.file(part, serializeXml(doc), { createFolders: false });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
