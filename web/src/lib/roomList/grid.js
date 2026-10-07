// Finding the rooms, and the lines for names, on a rooming list.
//
// Rooming lists are drawn, not designed: the hotel's sheet has a "2 PAX"
// label, the room number in a box that runs down as many rows as there are
// beds, and a wide box on each of those rows for a name. Next to it, a second
// block the same. On another sheet, a numbered list for the dorm. Nothing on
// it says "this column is the room" - so nothing here relies on a header row.
//
// What it relies on instead is the event's own room list. A box that says
// "204", when 204 is one of this event's rooms, is room 204; the rows it runs
// down are its beds; the first box to its right that is not a pax label or a
// bed description is where the names go. A sheet with no room numbers on it
// but a numbered list (1, 2, 3 ...) is a list for one room - which room, the
// sheet's name usually says ("DOORM TYPE"), and when it does not, a person
// picks.
//
// A grid is what every reader hands over, whatever the file was:
//   { key, label, title, cells: Map('r,c' -> { r, c, text, ref, formula }),
//     merges: [{ r1, c1, r2, c2 }], rows, cols }
// r and c count from 0. ref is the reader's own address for the box, kept
// so the writer can put a name back into exactly that box.

export const cellKey = (r, c) => `${r},${c}`;

/** A room number as it is compared: "Room 204" and "RM. 204" are 204. */
export function roomKey(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/^\s*(room|rm\.?|no\.?|#)\s*/, '')
    .replace(/[^a-z0-9]+/g, '');
}

// Boxes that describe a room rather than name somebody in it.
const PAX_LIKE = /^\s*\d{1,3}\s*(pax|persons?|people|guests?|beds?|heads?)?\s*$|\bpax\b/i;
const BED_LIKE = /\b(beds?|queen|king|double|single|twin|bunk|sofa)\b/i;
// A header over the names: "NAME OF GUESTS", "Occupants", "Guest 1".
const NAME_HEADER = /\b(names?|guests?|occupants?|attendees?|participants?|delegates?)\b/i;
const ROOMISH = /^\s*(room|rm\.?|no\.?|#)?\s*\d{3,5}[a-z]?\s*$/i;
// A box that is nothing but a heading: "NAMES", "Guest List", "Name of Occupants".
const HEADING_ONLY = /^\s*(full\s*)?(names?|guests?|occupants?|attendees?|participants?|delegates?)(\s+(list|names?))?\s*:?\s*$|^\s*names?\s+of\s+(the\s+)?\w+\s*:?\s*$/i;

function makeIndex(grid) {
  const owner = new Map(); // 'r,c' -> merge, for every box a merge covers
  grid.merges.forEach((m) => {
    for (let r = m.r1; r <= m.r2; r += 1) {
      for (let c = m.c1; c <= m.c2; c += 1) owner.set(cellKey(r, c), m);
    }
  });
  const span = (r, c) => owner.get(cellKey(r, c)) || { r1: r, c1: c, r2: r, c2: c };
  const cellAt = (r, c) => {
    const s = span(r, c);
    return grid.cells.get(cellKey(s.r1, s.c1)) || null;
  };
  const textAt = (r, c) => String(cellAt(r, c)?.text ?? '').trim();
  return { span, cellAt, textAt };
}

// Numbered lines - 1, 2, 3 down a column - are a list's line numbers, not
// rooms, even at an event with a room called "12".
function sequenceCells(grid, min) {
  const seq = new Set();
  const byCol = new Map();
  grid.cells.forEach((cell) => {
    if (/^\d{1,3}$/.test(String(cell.text ?? '').trim())) {
      if (!byCol.has(cell.c)) byCol.set(cell.c, []);
      byCol.get(cell.c).push(cell);
    }
  });
  const runs = [];
  byCol.forEach((list) => {
    list.sort((a, b) => a.r - b.r);
    let run = [];
    list.forEach((cell) => {
      const n = Number(String(cell.text).trim());
      if (n === 1) {
        if (run.length >= min) runs.push(run);
        run = [cell];
      } else if (run.length && n === Number(String(run[run.length - 1].text).trim()) + 1) {
        run.push(cell);
      } else {
        if (run.length >= min) runs.push(run);
        run = [];
      }
    });
    if (run.length >= min) runs.push(run);
  });
  runs.forEach((run) => run.forEach((cell) => seq.add(cellKey(cell.r, cell.c))));
  return { seq, runs };
}

/**
 * Every room on one grid, and the boxes its names go in.
 *
 * @param {object} grid
 * @param {Map<string, object>} rooms roomKey(room_number) -> the room
 * @param {Set<string>} typeKeys roomKey() of every room type at the event
 * @returns {{ found: Array<{room, slots}>, unknown: Array<{text, where}>, list: object|null }}
 */
export function detectGrid(grid, rooms, typeKeys) {
  const { span, cellAt, textAt } = makeIndex(grid);
  const { seq } = sequenceCells(grid, 3);

  const isRoomCell = (cell) => cell && !seq.has(cellKey(cell.r, cell.c)) && rooms.has(roomKey(cell.text));
  const isMeta = (text) => {
    const t = String(text ?? '').trim();
    if (!t) return false;
    return PAX_LIKE.test(t) || BED_LIKE.test(t) || typeKeys.has(roomKey(t));
  };

  // Header rows: a row with a names header and at least one other label.
  const headers = [];
  const rowCells = new Map();
  grid.cells.forEach((cell) => {
    if (!String(cell.text ?? '').trim()) return;
    if (!rowCells.has(cell.r)) rowCells.set(cell.r, []);
    rowCells.get(cell.r).push(cell);
  });
  rowCells.forEach((cells, r) => {
    if (cells.length < 2) return;
    cells.forEach((cell) => {
      const t = String(cell.text).trim();
      if (t.length <= 40 && NAME_HEADER.test(t) && !isRoomCell(cell)) headers.push({ r, c: cell.c });
    });
  });

  // ---- The rooms ----
  const anchors = [];
  grid.cells.forEach((cell) => {
    const s = span(cell.r, cell.c);
    if (s.r1 !== cell.r || s.c1 !== cell.c) return; // only the top-left of a merge holds its text
    if (isRoomCell(cell)) anchors.push({ cell, s, room: rooms.get(roomKey(cell.text)) });
  });
  anchors.sort((a, b) => a.s.c1 - b.s.c1 || a.s.r1 - b.s.r1);

  // The next row down this column that has anything in it - where a room
  // whose box is not merged stops.
  const nextFilledBelow = (r, c) => {
    for (let rr = r + 1; rr < grid.rows; rr += 1) {
      const s = span(rr, c);
      if (s.r1 === rr && textAt(rr, c)) return rr;
    }
    return grid.rows;
  };
  // The next column to the right, on these rows, that holds another room -
  // the start of the next block.
  const nextRoomCol = (rows, c) => {
    let best = grid.cols;
    anchors.forEach((a) => {
      if (a.s.c1 > c && a.s.c1 < best && a.s.r1 <= rows[rows.length - 1] && a.s.r2 >= rows[0]) best = a.s.c1;
    });
    return best;
  };

  const found = [];
  anchors.forEach(({ cell, s, room }) => {
    const pax = Math.max(1, Number(room.pax) || 1);

    // Which columns hold the names. A header over them wins; otherwise the
    // first box to the right that is not a label.
    let nameCols = [];
    const stop = nextRoomCol([s.r1, s.r2], s.c2);
    const header = headers
      .filter((h) => h.r < s.r1 && h.c > s.c2 && h.c < stop)
      .sort((a, b) => b.r - a.r || a.c - b.c);
    if (header.length) {
      const hr = header[0].r;
      nameCols = header.filter((h) => h.r === hr).map((h) => h.c);
    } else {
      let col = s.c2 + 1;
      for (let skips = 0; col < stop && skips < 3; skips += 1) {
        const rows = [];
        for (let r = s.r1; r <= s.r2; r += 1) rows.push(textAt(r, col));
        if (!rows.some(isMeta)) break;
        col = span(s.r1, col).c2 + 1;
      }
      if (col < stop) nameCols = [col];
    }
    if (!nameCols.length) return;

    // Which rows are its beds: the rows its box runs down; or, when the box
    // is one row, down to the next thing in its column - but not past a run
    // of empty lines beyond what the room sleeps.
    let r2 = s.r2;
    if (s.r2 === s.r1) {
      const limit = nextFilledBelow(s.r1, s.c1) - 1;
      r2 = s.r1;
      for (let r = s.r1 + 1; r <= limit; r += 1) {
        const named = nameCols.some((c) => textAt(r, c));
        if (!named && r - s.r1 >= pax) break;
        r2 = r;
      }
    }

    const slots = [];
    const seen = new Set();
    const add = (r, c) => {
      const box = span(r, c);
      const k = cellKey(box.r1, box.c1);
      if (seen.has(k)) return;
      seen.add(k);
      const at = cellAt(box.r1, box.c1);
      if (at?.formula) return; // a sum or a lookup is not somewhere to write a name
      slots.push({ r: box.r1, c: box.c1, text: textAt(box.r1, box.c1), ref: at?.ref ?? null });
    };
    for (let r = s.r1; r <= r2; r += 1) nameCols.forEach((c) => add(r, c));

    // One line for the room and no header: names written across it, one per
    // box - "204 | Juan | Maria".
    if (s.r1 === r2 && !header.length) {
      let c = span(s.r1, nameCols[0]).c2 + 1;
      while (c < stop) {
        const t = textAt(s.r1, c);
        if (!t || isMeta(t) || isRoomCell(cellAt(s.r1, c))) break;
        add(s.r1, c);
        c = span(s.r1, c).c2 + 1;
      }
    }
    found.push({ room, cell, slots });
  });

  // ---- Numbers that look like rooms this event does not have ----
  // Said out loud, because the names beside them would otherwise be dropped
  // without a word.
  const unknown = [];
  grid.cells.forEach((cell) => {
    const t = String(cell.text ?? '').trim();
    if (!ROOMISH.test(t) || isRoomCell(cell) || seq.has(cellKey(cell.r, cell.c))) return;
    const s = span(cell.r, cell.c);
    if (s.r1 !== cell.r || s.c1 !== cell.c) return;
    // A name within a few boxes to its right, past any pax or bed label.
    let c = s.c2 + 1;
    for (let k = 0; k < 3 && c < grid.cols; k += 1) {
      const right = textAt(cell.r, c);
      if (rooms.has(roomKey(right)) || ROOMISH.test(right)) break;
      if (right && !isMeta(right)) { unknown.push({ text: t, r: cell.r, c: cell.c }); break; }
      c = span(cell.r, c).c2 + 1;
    }
  });

  // ---- A list for one room ----
  // A sheet - the second tab, usually - with no room numbers on it at all:
  // the dorm's list. Read as one room's lines, whichever way it is drawn:
  //   numbered   1, 2, 3 ... (or 21, 22, 23 ... carrying on from another tab)
  //              down a column, the names in the box beside each number
  //   headed     a "NAMES" / "GUESTS" header, the names under it
  //   bare       just names down a column under a title - loose, and only
  //              used when the sheet's name says which room it is (index.js)
  let list = null;
  if (!anchors.length) {
    const box = (r, c) => {
      const b = span(r, c);
      const at = cellAt(b.r1, b.c1);
      return at?.formula ? null : { r: b.r1, c: b.c1, text: textAt(b.r1, b.c1), ref: at?.ref ?? null };
    };
    // More lines below the last one, down the same column - for a list
    // with fewer lines written than the room sleeps.
    const below = (col, fromRow) => (count) => {
      const out = [];
      for (let r = fromRow + 1; r < Math.max(grid.rows, fromRow + 1 + count) && out.length < count; r += 1) {
        const b = span(r, col);
        if (b.r1 !== r || b.c1 !== col) continue;
        const s = box(r, col);
        if (s) out.push(s);
      }
      return out;
    };

    const run = numberedRuns(grid, span)[0];
    const slots = [];
    let more = null;
    let loose = false;
    if (run) {
      run.forEach((n) => {
        const c = span(n.r, n.c).c2 + 1;
        if (c >= grid.cols) return;
        const s = box(n.r, c);
        if (s) slots.push(s);
      });
    } else if (headers.length) {
      const h = headers.sort((a, b) => a.r - b.r)[0];
      let last = h.r;
      grid.cells.forEach((cell) => { if (cell.c === h.c && cell.r > last && String(cell.text ?? '').trim()) last = cell.r; });
      for (let r = h.r + 1; r <= last; r += 1) {
        if (span(r, h.c).r1 !== r) continue;
        const s = box(r, h.c);
        if (s) slots.push(s);
      }
      more = below(h.c, last);
    } else {
      // Bare: the column with the most names in it, under the title.
      const title = [...grid.cells.values()]
        .filter((c) => String(c.text ?? '').trim())
        .sort((a, b) => a.r - b.r || a.c - b.c)[0];
      const byCol = new Map();
      grid.cells.forEach((cell) => {
        const t = String(cell.text ?? '').trim();
        if (!t || cell === title || cell.formula || isMeta(t) || /^\d+$/.test(t) || HEADING_ONLY.test(t) || !/[a-z]/i.test(t)) return;
        const s = span(cell.r, cell.c);
        if (s.r1 !== cell.r || s.c1 !== cell.c) return;
        if (!byCol.has(cell.c)) byCol.set(cell.c, []);
        byCol.get(cell.c).push(cell);
      });
      const best = [...byCol.values()].sort((a, b) => b.length - a.length)[0];
      if (best && best.length) {
        const col = best[0].c;
        const first = Math.min(...best.map((c) => c.r));
        const last = Math.max(...best.map((c) => c.r));
        for (let r = first; r <= last; r += 1) {
          if (span(r, col).r1 !== r) continue;
          const s = box(r, col);
          if (s) slots.push(s);
        }
        more = below(col, last);
        loose = true;
      }
    }
    if (slots.length) list = { slots, more, loose };
  }

  return { found, unknown, list };
}

// Line numbers down a column on a sheet with no rooms: 1, 2, 3 ..., or a
// list that carries on from another tab (21, 22, 23 ...). Two digits at most,
// so a run of room numbers the event does not have (701, 702, 703) is never
// taken for one. Longest first.
function numberedRuns(grid, span) {
  const byCol = new Map();
  grid.cells.forEach((cell) => {
    const t = String(cell.text ?? '').trim();
    if (!/^\d{1,3}$/.test(t)) return;
    const s = span(cell.r, cell.c);
    if (s.r1 !== cell.r || s.c1 !== cell.c) return;
    if (!byCol.has(cell.c)) byCol.set(cell.c, []);
    byCol.get(cell.c).push(cell);
  });
  const runs = [];
  byCol.forEach((list) => {
    list.sort((a, b) => a.r - b.r);
    let run = [];
    list.forEach((cell) => {
      const v = Number(String(cell.text).trim());
      const prev = run.length ? Number(String(run[run.length - 1].text).trim()) : null;
      if (prev !== null && v === prev + 1) run.push(cell);
      else {
        if (run.length >= 3) runs.push(run);
        run = Number(String(cell.text).trim()) < 100 ? [cell] : [];
      }
    });
    if (run.length >= 3) runs.push(run);
  });
  return runs.sort((a, b) => b.length - a.length);
}

/** "C3" for row 2, column 2 - how a spreadsheet person says where a box is. */
export function a1(r, c) {
  let n = c + 1;
  let col = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    col = String.fromCharCode(65 + m) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${r + 1}`;
}

/** The top text of a grid - "ROOM ASSIGNMENT", "DORMTYPE LIST". */
export function gridTitle(grid) {
  const top = [...grid.cells.values()]
    .filter((c) => String(c.text ?? '').trim() && c.r < 4)
    .sort((a, b) => a.r - b.r || a.c - b.c)[0];
  return top ? String(top.text).trim() : '';
}
