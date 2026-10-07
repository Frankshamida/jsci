// CSV rooming lists - what Google Sheets and most hotel systems save. Written
// back with the same separator, line endings and byte-order mark, so it opens
// the way it did.

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  let best = ',';
  let most = -1;
  [',', ';', '\t'].forEach((d) => {
    let n = 0;
    let quoted = false;
    for (const ch of sample) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n += 1;
    }
    if (n > most) { most = n; best = d; }
  });
  return best;
}

export function parseCsv(raw) {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const text = bom ? raw.slice(1) : raw;
  const delim = detectDelimiter(text);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const endsWithEol = /\r?\n$/.test(text);
  return { rows, delim, eol, bom, endsWithEol };
}

export function readCsv(buffer) {
  const { rows } = parseCsv(buffer.toString('utf8'));
  const cells = new Map();
  let cols = 0;
  rows.forEach((row, r) => {
    row.forEach((text, c) => {
      if (String(text).trim()) cells.set(`${r},${c}`, { r, c, text: String(text).trim(), ref: { r, c }, formula: false });
    });
    cols = Math.max(cols, row.length);
  });
  return [{ key: 'csv', label: 'Sheet', cells, merges: [], rows: rows.length, cols }];
}

export function fillCsv(buffer, writes) {
  const parsed = parseCsv(buffer.toString('utf8'));
  const { rows, delim, eol, bom, endsWithEol } = parsed;
  writes.forEach((w) => {
    const { r, c } = w.ref || {};
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
    while (rows.length <= r) rows.push([]);
    while (rows[r].length <= c) rows[r].push('');
    rows[r][c] = w.text || '';
  });
  const quote = (v) => (/["\r\n]/.test(v) || v.includes(delim) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = rows.map((row) => row.map((v) => quote(String(v ?? ''))).join(delim)).join(eol) + (endsWithEol ? eol : '');
  return Buffer.from((bom ? '﻿' : '') + out, 'utf8');
}
