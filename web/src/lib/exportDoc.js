// ============================================================
// One report, four files
// ============================================================
// Every export in the app is described the same way - a title, a few lines of
// context, a set of columns and the rows under them - and this file turns that
// one description into a PDF, a spreadsheet, a Word document or a CSV.
//
// Writing it once is the point. The alternative is four layouts that drift:
// the spreadsheet gains a column the PDF never hears about, the Word version
// keeps last year's heading, and the person who has to reconcile them finds
// three different totals. Here there is one `spec`, and the only thing that
// changes between formats is how it is drawn.
//
//   spec = {
//     title,        'Miracle Working God'
//     subtitle,     'Registered Attendees'
//     meta,         [['Venue', 'Cebu Parklane'], ['Date', 'Oct 2-3, 2026'], ...]
//     columns,      [{ key, label, align, width }]
//     rows,         [{ ...registration }]
//     orientation,  'portrait' | 'landscape'
//     footNote,     'Generated 25 Sep 2026 by Admin Jsci'
//   }
// ============================================================

import { zipFiles, xmlEscape } from './zipWriter';

const BRAND = {
  org: 'JOYFUL SOUND CHURCH INTERNATIONAL',
  gold: '926C15',
  goldSoft: 'F4EDDC',
  ink: '2B2100',
  grey: '6B6B6B',
  line: 'D9CDB0',
};

/** The cell value for a column, always a string, never null. */
function cellText(row, column) {
  const raw = typeof column.value === 'function' ? column.value(row) : row[column.key];
  if (raw === null || raw === undefined) return '';
  return String(raw);
}

// ============================================================
// PDF - by way of the browser's own print pipeline
// ============================================================
// There is no PDF writer here and there should not be one: the browser already
// has a good one behind Ctrl+P, it embeds the fonts, it paginates, and it is
// the only route that produces the same document on a phone as on a desk.
// What this builds is the page it prints - and `@page size` is what makes the
// orientation choice real rather than decorative.

export function buildPrintHtml(spec) {
  const { title, subtitle, meta = [], columns, rows, orientation = 'portrait', footNote = '' } = spec;

  const metaHtml = meta
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="meta-item"><span>${xmlEscape(label)}</span><b>${xmlEscape(value)}</b></div>`)
    .join('');

  const head = columns
    .map((c) => `<th class="align-${c.align || 'left'}">${xmlEscape(c.label)}</th>`)
    .join('');

  const body = rows.map((row, i) => {
    const cells = columns
      .map((c) => `<td class="align-${c.align || 'left'}">${xmlEscape(cellText(row, c))}</td>`)
      .join('');
    return `<tr class="${i % 2 ? 'alt' : ''}">${cells}</tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${xmlEscape(title)} — ${xmlEscape(subtitle)}</title>
<style>
  /* The orientation the person picked, handed to the print engine. Margins are
     generous at the top so the letterhead is not against the paper's edge. */
  @page { size: A4 ${orientation}; margin: 14mm 12mm 16mm; }

  /* Georgia for the letterhead, a humanist sans for everything that gets read
     in a hurry. Both are on every machine that will print this, which matters
     more than a webfont would: a print stylesheet that waits on a download
     prints in Times New Roman. */
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #${BRAND.ink};
    font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 9.5pt; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .sheet { padding: 0; }

  /* ---- Letterhead ---- */
  .head { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; border-bottom: 2.5px solid #${BRAND.gold}; }
  .head img { width: 52px; height: 52px; object-fit: contain; }
  .head-text { flex: 1; min-width: 0; }
  .org {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 13pt; font-weight: 700; letter-spacing: 0.06em;
    color: #${BRAND.gold}; margin: 0;
  }
  .doc-title { font-size: 15pt; font-weight: 700; margin: 3px 0 0; }
  .doc-sub { font-size: 9.5pt; color: #${BRAND.grey}; margin: 1px 0 0; letter-spacing: 0.04em; text-transform: uppercase; }

  /* ---- The facts about the event, above the table ---- */
  .meta { display: flex; flex-wrap: wrap; gap: 6px 26px; margin: 11px 0 13px; }
  .meta-item { display: flex; flex-direction: column; gap: 1px; }
  .meta-item span { font-size: 7.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: #${BRAND.grey}; }
  .meta-item b { font-size: 9.5pt; font-weight: 600; }

  /* ---- The table ---- */
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }   /* the heading repeats on every page */
  tr { page-break-inside: avoid; }
  th {
    background: #${BRAND.gold}; color: #fff; text-align: left;
    font-size: 8pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 7px 8px; border: 0.5pt solid #${BRAND.gold};
  }
  td { padding: 6px 8px; border: 0.5pt solid #${BRAND.line}; vertical-align: top; }
  tr.alt td { background: #FBF8F1; }
  .align-right { text-align: right; }
  .align-center { text-align: center; }

  .foot { margin-top: 12px; padding-top: 7px; border-top: 0.5pt solid #${BRAND.line}; font-size: 7.5pt; color: #${BRAND.grey}; display: flex; justify-content: space-between; gap: 16px; }
  .count { font-weight: 700; color: #${BRAND.ink}; }
</style></head>
<body><div class="sheet">
  <div class="head">
    <img src="/assets/LOGO.png" alt="">
    <div class="head-text">
      <p class="org">${xmlEscape(BRAND.org)}</p>
      <h1 class="doc-title">${xmlEscape(title)}</h1>
      <p class="doc-sub">${xmlEscape(subtitle)}</p>
    </div>
  </div>
  ${metaHtml ? `<div class="meta">${metaHtml}</div>` : ''}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <div class="foot">
    <span class="count">${rows.length} ${rows.length === 1 ? 'record' : 'records'}</span>
    <span>${xmlEscape(footNote)}</span>
  </div>
</div></body></html>`;
}

/**
 * Open the report in its own window and raise the print dialog, where the
 * person chooses their printer or "Save as PDF".
 *
 * The window is left open afterwards on purpose. Closing it the moment the
 * dialog is dismissed is a race nobody wins: Safari and most in-app browsers
 * report the dialog as closed before the PDF has been written, and the page
 * disappears mid-save.
 */
export function printReport(spec) {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return false;   // a pop-up blocker; the caller says so
  win.document.write(buildPrintHtml(spec));
  win.document.close();
  // The logo has to be on the page before the dialog opens, or the letterhead
  // prints with a gap where it should be.
  const go = () => { try { win.focus(); win.print(); } catch { /* the person closed it */ } };
  if (win.document.readyState === 'complete') setTimeout(go, 350);
  else win.onload = () => setTimeout(go, 250);
  return true;
}

// ============================================================
// XLSX
// ============================================================

function colLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// Style ids, in the order they are written into styles.xml below.
const S = { TITLE: 1, SUB: 2, METALABEL: 3, METAVALUE: 4, HEAD: 5, CELL: 6, CELLALT: 7, NUM: 8, NUMALT: 9 };

function sheetCell(ref, text, styleId, numeric) {
  if (text === '') return `<c r="${ref}" s="${styleId}"/>`;
  if (numeric) return `<c r="${ref}" s="${styleId}"><v>${xmlEscape(text)}</v></c>`;
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

export function buildXlsx(spec) {
  const { title, subtitle, meta = [], columns, rows, footNote = '' } = spec;
  const lastCol = colLetter(Math.max(0, columns.length - 1));
  const sheetRows = [];
  const merges = [];
  let r = 1;

  const titleRows = [[title, S.TITLE], [BRAND.org, S.SUB], [subtitle, S.SUB]];
  titleRows.forEach(([text, style]) => {
    sheetRows.push(`<row r="${r}" ht="${style === S.TITLE ? 26 : 16}" customHeight="1">${sheetCell(`A${r}`, text, style)}</row>`);
    if (columns.length > 1) merges.push(`A${r}:${lastCol}${r}`);
    r += 1;
  });
  r += 1; // a blank line under the heading

  meta.filter(([, value]) => value).forEach(([label, value]) => {
    sheetRows.push(`<row r="${r}">${sheetCell(`A${r}`, label, S.METALABEL)}${sheetCell(`B${r}`, value, S.METAVALUE)}</row>`);
    r += 1;
  });
  r += 1;

  const headRow = r;
  sheetRows.push(`<row r="${r}" ht="22" customHeight="1">${
    columns.map((c, i) => sheetCell(`${colLetter(i)}${r}`, c.label, S.HEAD)).join('')
  }</row>`);
  r += 1;

  rows.forEach((row, i) => {
    const alt = i % 2 === 1;
    const cells = columns.map((c, ci) => {
      const text = cellText(row, c);
      // A peso column is written as a NUMBER, not as "₱300": a spreadsheet
      // that cannot sum its own money column is a table with extra steps.
      const numeric = c.numeric && text !== '' && !Number.isNaN(Number(text));
      const style = numeric ? (alt ? S.NUMALT : S.NUM) : (alt ? S.CELLALT : S.CELL);
      return sheetCell(`${colLetter(ci)}${r}`, text, style, numeric);
    }).join('');
    sheetRows.push(`<row r="${r}">${cells}</row>`);
    r += 1;
  });

  r += 1;
  sheetRows.push(`<row r="${r}">${sheetCell(`A${r}`, `${rows.length} record${rows.length === 1 ? '' : 's'} — ${footNote}`, S.METALABEL)}</row>`);

  const cols = columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 18}" customWidth="1"/>`)
    .join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0" showGridLines="0">
<pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${sheetRows.join('')}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FF${BRAND.ink}"/><name val="Georgia"/></font>
<font><sz val="10"/><color rgb="FF${BRAND.grey}"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="9"/><color rgb="FF${BRAND.grey}"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF${BRAND.ink}"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${BRAND.gold}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBF8F1"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF${BRAND.line}"/></left><right style="thin"><color rgb="FF${BRAND.line}"/></right><top style="thin"><color rgb="FF${BRAND.line}"/></top><bottom style="thin"><color rgb="FF${BRAND.line}"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
</styleSheet>`;

  return zipFiles([
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(String(subtitle || 'Report').slice(0, 28))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', text: styles },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ============================================================
// DOCX
// ============================================================

/** One run of text, in half-points, with the usual switches. */
function docxRun(text, { bold, size = 20, color = BRAND.ink, caps, font } = {}) {
  return `<w:r><w:rPr>${font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>` : ''}${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:color w:val="${color}"/>${caps ? '<w:caps/>' : ''}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function docxPara(runs, { align, spaceAfter = 0, border } = {}) {
  const pr = `<w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:after="${spaceAfter}"/>${
    border ? `<w:pBdr><w:bottom w:val="single" w:sz="18" w:color="${BRAND.gold}"/></w:pBdr>` : ''
  }</w:pPr>`;
  return `<w:p>${pr}${runs}</w:p>`;
}

function docxCell(text, { head, width, align, alt } = {}) {
  const shade = head ? BRAND.gold : (alt ? 'FBF8F1' : 'FFFFFF');
  const run = docxRun(text, head
    ? { bold: true, size: 16, color: 'FFFFFF', caps: true }
    : { size: 18 });
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:fill="${shade}"/><w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr>${
    docxPara(run, { align: align === 'right' ? 'right' : align === 'center' ? 'center' : undefined })
  }</w:tc>`;
}

export function buildDocx(spec) {
  const { title, subtitle, meta = [], columns, rows, orientation = 'portrait', footNote = '' } = spec;

  // A4 in twentieths of a point, and the usable width once the margins are off.
  const A4 = { w: 11906, h: 16838 };
  const margin = 720;                                     // 0.5in
  const pageW = orientation === 'landscape' ? A4.h : A4.w;
  const usable = pageW - margin * 2;
  const weights = columns.map((c) => c.width || 18);
  const totalWeight = weights.reduce((t, w) => t + w, 0);
  const widths = weights.map((w) => Math.floor((w / totalWeight) * usable));

  const headRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${
    columns.map((c, i) => docxCell(c.label, { head: true, width: widths[i], align: c.align })).join('')
  }</w:tr>`;

  const bodyRows = rows.map((row, i) => `<w:tr>${
    columns.map((c, ci) => docxCell(cellText(row, c), { width: widths[ci], align: c.align, alt: i % 2 === 1 })).join('')
  }</w:tr>`).join('');

  const metaParas = meta.filter(([, value]) => value).map(([label, value]) => docxPara(
    docxRun(`${label}: `, { bold: true, size: 17, color: BRAND.grey }) + docxRun(value, { size: 17 }),
    { spaceAfter: 20 },
  )).join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${docxPara(docxRun(BRAND.org, { bold: true, size: 22, color: BRAND.gold, font: 'Georgia' }), { spaceAfter: 20 })}
${docxPara(docxRun(title, { bold: true, size: 32, font: 'Georgia' }), { spaceAfter: 20 })}
${docxPara(docxRun(subtitle, { size: 18, color: BRAND.grey, caps: true }), { spaceAfter: 140, border: true })}
${metaParas}
${docxPara('', { spaceAfter: 80 })}
<w:tbl>
<w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/>
<w:tblBorders>
<w:top w:val="single" w:sz="4" w:color="${BRAND.line}"/><w:left w:val="single" w:sz="4" w:color="${BRAND.line}"/>
<w:bottom w:val="single" w:sz="4" w:color="${BRAND.line}"/><w:right w:val="single" w:sz="4" w:color="${BRAND.line}"/>
<w:insideH w:val="single" w:sz="4" w:color="${BRAND.line}"/><w:insideV w:val="single" w:sz="4" w:color="${BRAND.line}"/>
</w:tblBorders></w:tblPr>
<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>
${headRow}${bodyRows}
</w:tbl>
${docxPara(docxRun(`${rows.length} record${rows.length === 1 ? '' : 's'}${footNote ? ` — ${footNote}` : ''}`, { size: 15, color: BRAND.grey }), { spaceAfter: 0 })}
<w:sectPr>
<w:pgSz w:w="${orientation === 'landscape' ? A4.h : A4.w}" w:h="${orientation === 'landscape' ? A4.w : A4.h}"${orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>
<w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="0" w:footer="0" w:gutter="0"/>
</w:sectPr>
</w:body></w:document>`;

  return zipFiles([
    {
      name: '[Content_Types].xml',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    { name: 'word/document.xml', text: document },
  ], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ============================================================
// CSV
// ============================================================

export function buildCsv(spec) {
  const { columns, rows } = spec;
  const quote = (value) => {
    const text = String(value === null || value === undefined ? '' : value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => quote(c.label)).join(',')];
  rows.forEach((row) => lines.push(columns.map((c) => quote(cellText(row, c))).join(',')));
  // A BOM, so Excel opens a UTF-8 CSV without turning "Ñ" into two characters.
  return new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

// ============================================================

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoked late: Safari has not finished reading the blob when the click
  // returns, and a URL revoked too early downloads an empty file there.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** A filename that every filesystem will accept. */
export function safeFilename(...parts) {
  return parts
    .filter(Boolean)
    .join('-')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '_')
    .slice(0, 120);
}

export default { buildPrintHtml, printReport, buildXlsx, buildDocx, buildCsv, downloadBlob, safeFilename };
