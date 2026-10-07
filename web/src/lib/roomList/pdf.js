// PDF rooming lists.
//
// A PDF has no boxes to put a name in - it is a drawing of a table. So the
// table is found the way a person finds it: the room numbers are text, and
// the lines drawn around them are the borders. A room's box runs from the
// border above its number to the border below it; its name boxes are the
// rows between those two borders, in the column to its right.
//
// Writing back draws over the drawing: the names that were there are covered
// with white, and the new names are written in the same boxes. Everything
// else on the page - the logo, the borders, the colours - is the imported
// page itself, untouched. When a PDF has no lines at all (a scan turned to
// text, a list typed with spaces) the rows are taken from where the names
// sit instead, which is close but not exact; the review screen shows every
// name with the room it was read into, so a stray one is seen before saving.
import { roomKey } from './grid';

const PAX_LIKE = /^\s*\d{1,3}\s*(pax|persons?|people|guests?|beds?|heads?)?\s*$|\bpax\b/i;
const BED_LIKE = /\b(beds?|queen|king|double|single|twin|bunk|sofa)\b/i;
const ROOMISH = /^\s*(room|rm\.?|no\.?|#)?\s*\d{3,5}[a-z]?\s*$/i;

async function pdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

// The key in the PDF's document properties where an export records what it
// painted over and what it wrote: { covers: [{page,x,y,w,h}],
// written: [{page,x,y,text}] } - written is each line's exact starting point.
const MARK = 'RoomListCovers';
const within = (b, x, y) => x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1;

// Text under paint is gone. What the export wrote on top of the paint is
// told apart from it by where it starts - the same name kept in the same box
// is written over its old self, and only one of the two is still there.
function visible(item, page, covered) {
  const str = String(item.str || '').trim();
  if (!str) return true;
  const [, , , , e, f] = item.transform;
  const x = e + (item.width || 0) / 2;
  const y = f + 2;
  if (!(covered.covers || []).some((b) => b.page === page && within(b, x, y))) return true;
  return (covered.written || []).some((w) => w.page === page
    && Math.abs(w.x - e) < 0.6 && Math.abs(w.y - f) < 0.6 && String(w.text).includes(str));
}

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// The straight lines on a page - table borders - in page space. Clipping
// paths are not drawn, so they are not borders; a filled box is a border
// only when it is thin (a hairline drawn as a rectangle), otherwise it is a
// cell's background.
function linesOf(ops, OPS) {
  const STROKES = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const FILLS = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const h = [];
  const v = [];
  const addSeg = (x1, y1, x2, y2) => {
    if (Math.abs(y1 - y2) < 0.6 && Math.abs(x1 - x2) > 2) h.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: (y1 + y2) / 2 });
    else if (Math.abs(x1 - x2) < 0.6 && Math.abs(y1 - y2) > 2) v.push({ y1: Math.min(y1, y2), y2: Math.max(y1, y2), x: (x1 + x2) / 2 });
  };
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mul(ctm, Array.from(args[0]));
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.constructPath) {
      const [paint, data] = args || [];
      const path = data?.[0];
      if (!path || typeof path.length !== 'number') continue;
      const stroke = STROKES.has(paint);
      const fill = FILLS.has(paint);
      if (!stroke && !fill) continue;
      // Walk the path one sub-path at a time.
      let sub = [];
      const flush = () => {
        if (sub.length < 2) { sub = []; return; }
        if (stroke) {
          for (let k = 1; k < sub.length; k += 1) addSeg(sub[k - 1][0], sub[k - 1][1], sub[k][0], sub[k][1]);
        } else {
          const xs = sub.map((p) => p[0]);
          const ys = sub.map((p) => p[1]);
          const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
          if (y2 - y1 < 2.5 && x2 - x1 > 2) h.push({ x1, x2, y: (y1 + y2) / 2 });
          else if (x2 - x1 < 2.5 && y2 - y1 > 2) v.push({ y1, y2, x: (x1 + x2) / 2 });
        }
        sub = [];
      };
      for (let k = 0; k < path.length;) {
        const op = path[k++];
        if (op === 0) { flush(); sub.push(apply(ctm, path[k++], path[k++])); }
        else if (op === 1) sub.push(apply(ctm, path[k++], path[k++]));
        else if (op === 2) { k += 4; sub.push(apply(ctm, path[k++], path[k++])); }
        else if (op === 3) { if (sub.length) sub.push(sub[0]); }
        else break;
      }
      flush();
    }
  }
  return { h, v };
}

// Text on a page, joined into the pieces a person reads as one: a name
// written as three separate words is one name, unless a border runs between
// them.
function chunksOf(items, lines) {
  const raw = items
    .filter((it) => String(it.str || '').trim())
    .map((it) => {
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      return { text: String(it.str), x: e, y: f, w: it.width || 0, size };
    })
    .sort((p, q) => q.y - p.y || p.x - q.x);
  const rows = [];
  raw.forEach((it) => {
    const row = rows.find((r) => Math.abs(r.y - it.y) < it.size * 0.35);
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  });
  const out = [];
  rows.forEach((row) => {
    row.items.sort((p, q) => p.x - q.x);
    let cur = null;
    row.items.forEach((it) => {
      const gap = cur ? it.x - (cur.x + cur.w) : Infinity;
      const walled = cur && lines.v.some((l) => l.x > cur.x + cur.w - 1 && l.x < it.x + 1 && l.y1 <= it.y + 1 && l.y2 >= it.y);
      if (cur && gap < Math.max(cur.size * 0.9, 3) && !walled) {
        cur.text += (gap > cur.size * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(it.text) ? ' ' : '') + it.text;
        cur.w = it.x + it.w - cur.x;
      } else {
        cur = { ...it };
        out.push(cur);
      }
    });
  });
  return out.map((ch) => ({
    ...ch,
    text: ch.text.replace(/\s+/g, ' ').trim(),
    cx: ch.x + ch.w / 2,
    cy: ch.y + ch.size * 0.35,
    box: { x: ch.x, y: ch.y - ch.size * 0.25, w: ch.w, h: ch.size * 1.15 },
  })).filter((ch) => ch.text);
}

/** Every page of the PDF: its text pieces and its border lines. */
export async function readPdf(buffer) {
  const lib = await pdfjs();
  let doc;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
    }).promise;
  } catch (err) {
    if (/password/i.test(err?.message || '')) throw new Error('That PDF is password-protected. Save a copy without the password and import that.');
    throw new Error('That PDF could not be read.');
  }
  // A PDF this system exported has names painted over, and the old words are
  // still in the file under the paint. The export noted where it painted and
  // what it wrote (see fillPdf), so those old words are not read back as if
  // they were still on the list.
  const covered = await doc.getMetadata()
    .then((m) => JSON.parse(m?.info?.Custom?.[MARK] || 'null'))
    .catch(() => null);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const lines = linesOf(await page.getOperatorList(), lib.OPS);
    let { items } = await page.getTextContent();
    if (covered) items = items.filter((it) => visible(it, n - 1, covered));
    pages.push({ index: n - 1, view: { x0, y0, x1, y1 }, lines, chunks: chunksOf(items, lines) });
  }
  await doc.destroy();
  return pages;
}

// ---- Finding the rooms ----

const covering = (hs, x) => hs.filter((l) => l.x1 - 1 <= x && l.x2 + 1 >= x);
const coveringY = (vs, y) => vs.filter((l) => l.y1 - 1 <= y && l.y2 + 1 >= y);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function sequenceChunks(chunks) {
  const nums = chunks.filter((c) => /^\d{1,3}$/.test(c.text));
  const seq = new Set();
  const runs = [];
  nums.filter((c) => c.text === '1').forEach((start) => {
    const run = [start];
    let want = 2;
    for (;;) {
      const next = nums.find((c) => Number(c.text) === want && Math.abs(c.x - start.x) < 8 && c.y < run[run.length - 1].y);
      if (!next) break;
      run.push(next);
      want += 1;
    }
    if (run.length >= 3) { runs.push(run); run.forEach((c) => seq.add(c)); }
  });
  return { seq, runs };
}

/**
 * The rooms on a PDF and the boxes their names go in - the same answer the
 * grid reader gives, for the PDF's pages.
 */
export function detectPdf(pages, rooms, typeKeys) {
  const found = [];
  const unknown = [];
  const lists = [];
  const isMeta = (t) => PAX_LIKE.test(t) || BED_LIKE.test(t) || typeKeys.has(roomKey(t));

  pages.forEach((page) => {
    const { chunks, lines, view, index } = page;
    const { seq, runs } = sequenceChunks(chunks);
    const roomChunks = chunks.filter((c) => !seq.has(c) && rooms.has(roomKey(c.text)));
    const right = view.x1 - 30;
    const nameSizes = [];

    // The text in a box, top line first, and the boxes to cover.
    const inside = (x1, x2, y1, y2) => chunks.filter((c) => c.cx > x1 && c.cx < x2 && c.cy > y1 && c.cy < y2);
    const slotFor = (x1, x2, y1, y2, extra = {}) => {
      const here = inside(x1, x2, y1, y2).sort((a, b) => b.y - a.y || a.x - b.x);
      here.forEach((c) => nameSizes.push(c.size));
      return {
        id: `p${index}:${Math.round(x1)},${Math.round(y1)}`,
        text: here.map((c) => c.text).join('\n'),
        ref: { page: index, x: x1, y: y1, w: x2 - x1, h: y2 - y1, size: here[0]?.size || 0, cover: here.map((c) => c.box), ...extra },
      };
    };

    // Where a box ends to the right: the next border down the side of it.
    const nextWall = (x, yMid) => coveringY(lines.v, yMid).map((l) => l.x).filter((lx) => lx > x + 1).sort((a, b) => a - b)[0];

    roomChunks.forEach((rc) => {
      const room = rooms.get(roomKey(rc.text));
      const hs = covering(lines.h, rc.cx);
      const top = hs.filter((l) => l.y > rc.cy + 1).sort((a, b) => a.y - b.y)[0];
      const bottom = hs.filter((l) => l.y < rc.cy - 1).sort((a, b) => b.y - a.y)[0];
      const slots = [];

      if (top && bottom && lines.v.length) {
        // ---- A drawn table ----
        const mid = (top.y + bottom.y) / 2;
        let xL = nextWall(rc.x + rc.w - 1, mid);
        let xR = xL !== undefined ? nextWall(xL, mid) ?? right : undefined;
        for (let skips = 0; xL !== undefined && skips < 3; skips += 1) {
          const texts = inside(xL, xR, bottom.y, top.y);
          if (texts.some((c) => rooms.has(roomKey(c.text)) && !seq.has(c))) { xL = undefined; break; }
          if (!texts.some((c) => isMeta(c.text))) break;
          xL = xR;
          xR = nextWall(xL, mid) ?? right;
        }
        if (xL === undefined || xR <= xL) return;
        const cuts = covering(lines.h, (xL + xR) / 2)
          .map((l) => l.y).filter((y) => y > bottom.y + 2 && y < top.y - 2);
        const ys = [...new Set([bottom.y, ...cuts, top.y].map((y) => Math.round(y * 10) / 10))].sort((a, b) => b - a);
        for (let k = 1; k < ys.length; k += 1) {
          if (ys[k - 1] - ys[k] > 4) slots.push(slotFor(xL, xR, ys[k], ys[k - 1]));
        }
      } else {
        // ---- No lines: the names beside the number, to the next number ----
        const sameCol = roomChunks.filter((o) => o !== rc && Math.abs(o.x - rc.x) < 12).map((o) => o.cy);
        const above = sameCol.filter((y) => y > rc.cy).sort((a, b) => a - b)[0];
        const below = sameCol.filter((y) => y < rc.cy).sort((a, b) => b - a)[0];
        const y2 = above !== undefined ? (rc.cy + above) / 2 : rc.cy + rc.size * 1.2;
        const y1 = below !== undefined ? (rc.cy + below) / 2 : rc.cy - rc.size * 6;
        const nextRoomRight = roomChunks
          .filter((o) => o.x > rc.x + rc.w && Math.abs(o.cy - rc.cy) < rc.size * 3).map((o) => o.x).sort((a, b) => a - b)[0];
        const xL = rc.x + rc.w + 2;
        const xR = nextRoomRight !== undefined ? nextRoomRight - 2 : right;
        const names = inside(xL, xR, y1, y2).filter((c) => !isMeta(c.text) && !seq.has(c));
        if (names.length) {
          const x = Math.min(...names.map((c) => c.x)) - 2;
          names.sort((a, b) => b.y - a.y).forEach((c) => {
            slots.push({
              id: `p${index}:${Math.round(c.x)},${Math.round(c.y)}`,
              text: c.text,
              ref: { page: index, x, y: c.y - c.size * 0.4, w: xR - x, h: c.size * 1.4, size: c.size, cover: [c.box] },
            });
            nameSizes.push(c.size);
          });
        } else {
          slots.push({
            id: `p${index}:${Math.round(xL)},${Math.round(rc.y)}`,
            text: '',
            ref: { page: index, x: xL + 6, y: rc.y - rc.size * 0.4, w: xR - xL - 6, h: rc.size * 1.4, size: rc.size, cover: [] },
          });
        }
      }
      if (slots.length) found.push({ room, slots, where: `Page ${index + 1}` });
    });

    // Numbers that look like rooms this event does not have.
    chunks.forEach((c) => {
      if (!ROOMISH.test(c.text) || seq.has(c) || rooms.has(roomKey(c.text))) return;
      const beside = chunks.find((o) => o !== c && o.x > c.x + c.w && Math.abs(o.cy - c.cy) < c.size * 0.6);
      if (beside && !isMeta(beside.text) && !rooms.has(roomKey(beside.text))) unknown.push({ text: c.text, where: `Page ${index + 1}` });
    });

    // A page with no rooms but numbered lines: a list for one room.
    if (!roomChunks.length && runs.length) {
      const run = runs.sort((a, b) => b.length - a.length)[0];
      const gap = run.length > 1 ? Math.abs(run[0].y - run[1].y) : run[0].size * 1.6;
      const slots = run.map((n) => {
        const hs = covering(lines.h, n.cx);
        const top = hs.filter((l) => l.y > n.cy + 1).sort((a, b) => a.y - b.y)[0];
        const bottom = hs.filter((l) => l.y < n.cy - 1).sort((a, b) => b.y - a.y)[0];
        const y2 = top ? top.y : n.cy + gap / 2;
        const y1 = bottom ? bottom.y : n.cy - gap / 2;
        const xL = nextWall(n.x + n.w - 1, (y1 + y2) / 2) ?? n.x + n.w + 6;
        const xR = nextWall(xL, (y1 + y2) / 2) ?? right;
        return slotFor(xL, xR, y1, y2);
      });
      const title = chunks.filter((c) => !seq.has(c)).sort((a, b) => b.y - a.y)[0]?.text || '';
      lists.push({ key: `p${index}`, label: `Page ${index + 1}`, title, slots });
    }

    // A box that had no name in it is written at the size the other names
    // on the page are.
    const size = median(nameSizes) || 0;
    [...found.filter((f) => f.slots[0]?.ref.page === index).flatMap((f) => f.slots), ...lists.filter((l) => l.key === `p${index}`).flatMap((l) => l.slots)]
      .forEach((s) => { if (!s.ref.size) s.ref.size = size; });
  });

  return { found, unknown, lists };
}

// ---- Writing ----

/**
 * The PDF, with the old names covered and these names written in their boxes.
 *
 * @param {Array<{ref, text}>} writes ref as detectPdf made it
 */
export async function fillPdf(buffer, writes) {
  const { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  // What earlier exports painted over stays painted over, so it is kept on
  // the list of covers; what they wrote is replaced by what this one writes.
  const info = pdf.getInfoDict();
  let before = null;
  try { before = JSON.parse(info.lookup(PDFName.of(MARK))?.decodeText() || 'null'); } catch { before = null; }
  const covers = [...(before?.covers || [])];
  const written = [];

  // The standard PDF font has no Chinese, no emoji: a letter it cannot write
  // is written without its accent, or as "?", rather than failing the file.
  const safe = (s) => [...String(s).normalize('NFC')].map((ch) => {
    try { font.encodeText(ch); return ch; } catch { /* try plainer */ }
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    try { font.encodeText(base); return base; } catch { return '?'; }
  }).join('');

  writes.forEach(({ ref, text }) => {
    const page = pages[ref?.page];
    if (!page) return;
    (ref.cover || []).forEach((b) => {
      page.drawRectangle({ x: b.x - 0.8, y: b.y - 0.8, width: b.w + 1.6, height: b.h + 1.6, color: rgb(1, 1, 1) });
      covers.push({ page: ref.page, x: b.x - 0.8, y: b.y - 0.8, w: b.w + 1.6, h: b.h + 1.6 });
    });
    if (!text) return;
    const lines = String(text).split('\n').map(safe);
    const pad = 3;
    let size = ref.size || Math.min(10, ref.h * 0.6);
    const widest = () => Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size)));
    while (size > 5 && (widest() > ref.w - pad * 2 || lines.length * size * 1.15 > ref.h)) size -= 0.5;
    const lead = size * 1.15;
    const top = ref.y + (ref.h + lines.length * lead) / 2;
    lines.forEach((line, i) => {
      const at = { x: ref.x + pad, y: top - (i + 1) * lead + (lead - size) / 2 + size * 0.22 };
      page.drawText(line, { ...at, size, font, color: rgb(0, 0, 0) });
      written.push({ page: ref.page, ...at, text: line });
    });
  });
  const round = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]));
  info.set(PDFName.of(MARK), PDFHexString.fromText(JSON.stringify({ covers: covers.map(round), written: written.map(round) })));
  return Buffer.from(await pdf.save());
}

