// ============================================================
// A PDF writer, for reports this app already knows how to lay out
// ============================================================
// Printing to "Save as PDF" works, but it is not a download: it is a dialog,
// three clicks, a filename nobody chose, and on a phone it is often no PDF at
// all. A report that can be mailed to a pastor has to arrive as a file.
//
// So this writes the PDF itself. It is a smaller job than it sounds, because
// the report is a table and PDF's own text operators are enough to draw one:
// no font embedding (the fourteen standard fonts are in every reader ever
// written), no compression (a reader is required to accept uncompressed
// streams), and no general layout engine - only the one layout this app has.
//
// What is here, and nothing more:
//   - A4, either orientation, with margins
//   - Helvetica and Times-Bold, measured properly from their real metrics
//   - Word-wrapped cells, so a long church name makes a row taller instead of
//     running into the next column
//   - A heading that repeats on every page, and page numbers
//   - The logo, embedded as a JPEG
// ============================================================

// ---- Metrics for the three standard fonts this uses ----
// The widths the fonts themselves declare, in 1/1000 em, for codes 32-126.
// Without these, wrapping is guesswork and columns overrun.
const W_HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const W_TIMES_B = [250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500, 333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520];

export const FONTS = {
  helv: { res: 'F1', widths: W_HELV, fallback: 556 },
  helvBold: { res: 'F2', widths: W_HELV_B, fallback: 611 },
  timesBold: { res: 'F3', widths: W_TIMES_B, fallback: 500 },
};

// Characters that are not in WinAnsi at all, mapped to what a reader would
// have written by hand. An en dash IS in WinAnsi (0x96) and survives; a peso
// sign is not, and "PHP" beats a black box on a printed report.
const TRANSLITERATE = {
  '₱': 'PHP ', '‘': "'", '’': "'", '“': '"', '”': '"',
  '•': '-', '…': '...', ' ': ' ', '–': '\u0096', '—': '\u0097',
};

/** Text as WinAnsi bytes, expressed as a JS string of code points 0-255. */
function toWinAnsi(text) {
  let out = '';
  for (const ch of String(text === null || text === undefined ? '' : text)) {
    if (TRANSLITERATE[ch] !== undefined) { out += TRANSLITERATE[ch]; continue; }
    const code = ch.codePointAt(0);
    if (code <= 0xFF) out += ch;
    else out += '?';   // something outside Latin-1 entirely
  }
  return out;
}

/** A PDF literal string: parentheses and backslashes have meaning inside one. */
function pdfString(text) {
  return toWinAnsi(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function textWidth(text, font, size) {
  const win = toWinAnsi(text);
  let total = 0;
  for (let i = 0; i < win.length; i += 1) {
    const code = win.charCodeAt(i);
    total += (code >= 32 && code <= 126) ? font.widths[code - 32] : font.fallback;
  }
  return (total / 1000) * size;
}

/** Break `text` into lines that each fit `maxWidth`. Long words are cut. */
export function wrapText(text, font, size, maxWidth) {
  const source = String(text === null || text === undefined ? '' : text).trim();
  if (!source) return [''];
  const lines = [];
  let line = '';
  source.split(/\s+/).forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, font, size) <= maxWidth) { line = candidate; return; }
    if (line) { lines.push(line); line = ''; }
    // A single word too long for the column - a pasted email, usually.
    let chunk = word;
    while (textWidth(chunk, font, size) > maxWidth && chunk.length > 1) {
      let cut = chunk.length - 1;
      while (cut > 1 && textWidth(chunk.slice(0, cut), font, size) > maxWidth) cut -= 1;
      lines.push(chunk.slice(0, cut));
      chunk = chunk.slice(cut);
    }
    line = chunk;
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// ---- The drawing surface ----------------------------------------------------

function contentBuilder() {
  const ops = [];
  return {
    ops,
    // PDF's y axis runs up from the bottom-left; every call here takes a y
    // measured down from the top and flips it, because that is how the rest of
    // this file (and everybody reading it) thinks about a page.
    text(str, x, yFromTop, font, size, rgb, pageH) {
      ops.push(`BT /${font.res} ${size} Tf ${rgb} rg 1 0 0 1 ${x.toFixed(2)} ${(pageH - yFromTop).toFixed(2)} Tm (${pdfString(str)}) Tj ET`);
    },
    rect(x, yFromTop, w, h, rgb, pageH) {
      ops.push(`${rgb} rg ${x.toFixed(2)} ${(pageH - yFromTop - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    },
    line(x1, y1, x2, y2, rgb, width, pageH) {
      ops.push(`${rgb} RG ${width} w ${x1.toFixed(2)} ${(pageH - y1).toFixed(2)} m ${x2.toFixed(2)} ${(pageH - y2).toFixed(2)} l S`);
    },
    image(name, x, yFromTop, w, h, pageH) {
      ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(pageH - yFromTop - h).toFixed(2)} cm /${name} Do Q`);
    },
    toString() { return ops.join('\n'); },
  };
}

// ---- Assembling the file ----------------------------------------------------

function latin1Bytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}

/**
 * Serialise objects into a PDF. `objects` is an array of either strings (a
 * complete object body) or { dict, stream } where stream is a Uint8Array.
 */
function assemble(objects) {
  const parts = [];
  const offsets = [0];
  let length = 0;
  const push = (bytes) => { parts.push(bytes); length += bytes.length; };

  push(latin1Bytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));

  objects.forEach((obj, i) => {
    offsets[i + 1] = length;
    const id = i + 1;
    if (typeof obj === 'string') {
      push(latin1Bytes(`${id} 0 obj\n${obj}\nendobj\n`));
    } else {
      push(latin1Bytes(`${id} 0 obj\n${obj.dict}\nstream\n`));
      push(obj.stream);
      push(latin1Bytes('\nendstream\nendobj\n'));
    }
  });

  const xrefAt = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(latin1Bytes(xref));

  return new Blob(parts, { type: 'application/pdf' });
}

// ---- The report layout ------------------------------------------------------

const GOLD = '0.573 0.424 0.082';
const INK = '0.169 0.129 0.000';
const GREY = '0.42 0.42 0.42';
const LINE = '0.851 0.804 0.690';
const ALT = '0.984 0.973 0.945';
const WHITE = '1 1 1';

const A4 = { w: 595.28, h: 841.89 };

/**
 * Draw a report and return a PDF Blob.
 *
 * @param {object} spec              the same spec the other exporters take
 * @param {{data: Uint8Array, width: number, height: number}} [logo]  optional JPEG
 */
export function buildPdf(spec, logo) {
  const { title, subtitle, meta = [], columns, rows, orientation = 'portrait', footNote = '' } = spec;
  const pageW = orientation === 'landscape' ? A4.h : A4.w;
  const pageH = orientation === 'landscape' ? A4.w : A4.h;
  const MARGIN = 34;
  const contentW = pageW - MARGIN * 2;

  const FS = { org: 11, title: 15, sub: 8, metaLabel: 6.5, metaValue: 8.5, head: 7.5, cell: 8, foot: 7 };
  const CELL_PAD = 5;
  const LINE_H = 10.5;

  // Column widths, shared out by weight.
  const weights = columns.map((c) => c.width || 18);
  const totalWeight = weights.reduce((t, w) => t + w, 0);
  const colW = weights.map((w) => (w / totalWeight) * contentW);
  const colX = [];
  colW.reduce((x, w, i) => { colX[i] = x; return x + w; }, MARGIN);

  // Every row measured before anything is drawn, so a row is never split
  // across a page break.
  const measured = rows.map((row) => {
    const cells = columns.map((c, i) => {
      const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
      return wrapText(raw, FONTS.helv, FS.cell, colW[i] - CELL_PAD * 2);
    });
    const lines = Math.max(1, ...cells.map((l) => l.length));
    return { cells, height: lines * LINE_H + CELL_PAD * 2 };
  });

  const pages = [];
  let content = null;
  let y = 0;
  let firstPage = true;

  const drawLetterhead = (full) => {
    let top = MARGIN;
    if (full) {
      const logoW = 38;
      let textX = MARGIN;
      if (logo) {
        const h = logoW * (logo.height / logo.width);
        content.image('Im0', MARGIN, top + (46 - h) / 2, logoW, h, pageH);
        textX = MARGIN + logoW + 12;
      }
      content.text('JOYFUL SOUND CHURCH INTERNATIONAL', textX, top + 9, FONTS.timesBold, FS.org, GOLD, pageH);
      content.text(title, textX, top + 26, FONTS.helvBold, FS.title, INK, pageH);
      content.text(String(subtitle || '').toUpperCase(), textX, top + 38, FONTS.helv, FS.sub, GREY, pageH);
      top += 48;
      content.line(MARGIN, top, pageW - MARGIN, top, GOLD, 1.6, pageH);
      top += 14;

      // The event's own details, laid out in as many columns as fit.
      const shown = meta.filter(([, value]) => value);
      if (shown.length) {
        const perCol = contentW / Math.min(4, shown.length || 1);
        let col = 0;
        let rowTop = top;
        shown.forEach(([label, value]) => {
          const x = MARGIN + (col % 4) * perCol;
          content.text(String(label).toUpperCase(), x, rowTop + 6, FONTS.helvBold, FS.metaLabel, GREY, pageH);
          wrapText(value, FONTS.helv, FS.metaValue, perCol - 10).slice(0, 2).forEach((lineText, li) => {
            content.text(lineText, x, rowTop + 17 + li * 10, FONTS.helv, FS.metaValue, INK, pageH);
          });
          col += 1;
          if (col % 4 === 0) rowTop += 32;
        });
        top = rowTop + (col % 4 === 0 ? 4 : 32);
      }
    } else {
      // Continuation pages: one quiet line, so a loose sheet still says what
      // it belongs to without repeating the whole letterhead.
      content.text(`${title} — ${subtitle}`, MARGIN, top + 7, FONTS.helvBold, 8.5, GREY, pageH);
      top += 16;
      content.line(MARGIN, top, pageW - MARGIN, top, LINE, 0.7, pageH);
      top += 10;
    }
    return top;
  };

  const drawTableHead = (top) => {
    const h = 18;
    content.rect(MARGIN, top, contentW, h, GOLD, pageH);
    columns.forEach((c, i) => {
      const label = wrapText(c.label.toUpperCase(), FONTS.helvBold, FS.head, colW[i] - CELL_PAD * 2)[0];
      const x = c.align === 'right'
        ? colX[i] + colW[i] - CELL_PAD - textWidth(label, FONTS.helvBold, FS.head)
        : c.align === 'center'
          ? colX[i] + (colW[i] - textWidth(label, FONTS.helvBold, FS.head)) / 2
          : colX[i] + CELL_PAD;
      content.text(label, x, top + 12, FONTS.helvBold, FS.head, WHITE, pageH);
    });
    return top + h;
  };

  const newPage = () => {
    content = contentBuilder();
    y = drawLetterhead(firstPage);
    y = drawTableHead(y);
    pages.push(content);
  };

  newPage();
  firstPage = false;

  const bottomLimit = pageH - MARGIN - 22;

  measured.forEach((row, index) => {
    if (y + row.height > bottomLimit) { newPage(); }
    if (index % 2 === 1) content.rect(MARGIN, y, contentW, row.height, ALT, pageH);

    row.cells.forEach((lines, ci) => {
      const c = columns[ci];
      lines.forEach((lineText, li) => {
        const w = textWidth(lineText, FONTS.helv, FS.cell);
        const x = c.align === 'right'
          ? colX[ci] + colW[ci] - CELL_PAD - w
          : c.align === 'center'
            ? colX[ci] + (colW[ci] - w) / 2
            : colX[ci] + CELL_PAD;
        content.text(lineText, x, y + CELL_PAD + 7.5 + li * LINE_H, FONTS.helv, FS.cell, INK, pageH);
      });
    });

    // Cell separators, drawn per row so they stop where the row stops.
    content.line(MARGIN, y + row.height, pageW - MARGIN, y + row.height, LINE, 0.4, pageH);
    colX.forEach((x, i) => { if (i > 0) content.line(x, y, x, y + row.height, LINE, 0.4, pageH); });
    content.line(MARGIN, y, MARGIN, y + row.height, LINE, 0.4, pageH);
    content.line(pageW - MARGIN, y, pageW - MARGIN, y + row.height, LINE, 0.4, pageH);

    y += row.height;
  });

  // Footers, once the page count is known.
  pages.forEach((page, i) => {
    const footY = pageH - MARGIN + 2;
    page.line(MARGIN, footY - 10, pageW - MARGIN, footY - 10, LINE, 0.5, pageH);
    page.text(`${rows.length} ${rows.length === 1 ? 'record' : 'records'}`, MARGIN, footY, FONTS.helvBold, FS.foot, INK, pageH);
    const right = `Page ${i + 1} of ${pages.length}`;
    page.text(right, pageW - MARGIN - textWidth(right, FONTS.helv, FS.foot), footY, FONTS.helv, FS.foot, GREY, pageH);
    if (footNote) {
      const w = textWidth(footNote, FONTS.helv, FS.foot);
      page.text(footNote, MARGIN + (contentW - w) / 2, footY, FONTS.helv, FS.foot, GREY, pageH);
    }
  });

  // ---- objects ----
  // 1 catalog, 2 pages, 3-5 fonts, 6 image (when there is one), then a page
  // object and a content stream for each page.
  const objects = [];
  const imageId = logo ? 6 : 0;
  const firstPageId = logo ? 7 : 6;

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${firstPageId + i * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>');
  if (logo) {
    objects.push({
      dict: `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.data.length} >>`,
      stream: logo.data,
    });
  }

  const resources = `<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${logo ? ` /XObject << /Im0 ${imageId} 0 R >>` : ''} >>`;
  pages.forEach((page, i) => {
    const pageId = firstPageId + i * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources ${resources} /Contents ${pageId + 1} 0 R >>`);
    const body = latin1Bytes(page.toString());
    objects.push({ dict: `<< /Length ${body.length} >>`, stream: body });
  });

  return assemble(objects);
}

/**
 * The church logo as a JPEG, ready to embed. Returns null rather than throwing:
 * a missing logo costs the report its emblem, not its export.
 */
export async function loadLogoJpeg(src = '/assets/LOGO.png') {
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = src;
    });
    const scale = Math.min(1, 240 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    // JPEG has no transparency, and the page behind it is white.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    return { data, width: canvas.width, height: canvas.height };
  } catch { return null; }
}

export default buildPdf;
