// A rooming list, whatever it was made in.
//
// Import: the file is read into its rooms and the boxes their names are in
// (the LAYOUT), and every name is matched to a person on the event. Nothing
// is assigned here - the route shows the result to somebody first.
//
// Export: the same file, with each room's boxes holding the names of the
// people the system has in that room now. The layout is kept from the
// import, so the export writes into the boxes the import read from, in the
// file the import was given - its design is the hotel's, not ours.
//
// Formats: .xlsx (Excel, and Google Sheets downloaded or linked), .csv,
// .docx (Word, and Google Docs), and .pdf. Old .xls / .doc and OpenDocument
// files are refused with how to save them as one of those.
import JSZip from 'jszip';
import { compareRoomNumbers } from '@/lib/rooms';
import { a1, detectGrid, gridTitle, roomKey } from './grid';
import { boxSeparator, nameIndex, readBox } from './names';
import { fillXlsx, readXlsx } from './xlsx';
import { fillDocx, readDocx } from './docx';
import { fillCsv, readCsv } from './csv';
import { detectPdf, fillPdf, readPdf } from './pdf';

export const MAX_BYTES = 8 * 1024 * 1024;

export const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
};

/** What a file is, from its first bytes rather than its name. Throws a sentence a person can act on. */
export async function fileKind(buffer, fileName) {
  const b = buffer;
  const name = String(fileName || '').toLowerCase();
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    throw new Error(/\.doc$/.test(name)
      ? 'That is an old Word file (.doc). Open it in Word, choose File > Save As > Word Document (.docx), and import that.'
      : 'That is an old Excel file (.xls). Open it in Excel, choose File > Save As > Excel Workbook (.xlsx), and import that.');
  }
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buffer).catch(() => null);
    if (zip?.file('xl/workbook.xml')) return 'xlsx';
    if (zip?.file('word/document.xml')) return 'docx';
    if (zip?.file('content.xml')) throw new Error('That is an OpenDocument file (.ods / .odt). Save it as .xlsx or .docx and import that.');
  }
  if (/\.(csv|tsv|txt)$/.test(name)) return 'csv';
  throw new Error('Import an Excel (.xlsx), CSV, Word (.docx) or PDF file - or paste a Google Sheets / Google Docs link.');
}

const byRoomNumber = (a, b) => compareRoomNumbers(a.label, b.label);

// Does the word k appear in h, allowing one slip of spelling in a long word -
// "DORMTYPE LIST" is about the room typed "Doormtype".
function mentions(h, k) {
  if (h.includes(k) || (h.length >= 4 && k.includes(h))) return true;
  if (k.length < 6) return false;
  for (let len = k.length - 1; len <= k.length + 1; len += 1) {
    for (let i = 0; i + len <= h.length; i += 1) {
      if (oneSlip(h.slice(i, i + len), k)) return true;
    }
  }
  return false;
}
function oneSlip(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    slips += 1;
    if (slips > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

// A sheet with only a numbered list on it ("DORMTYPE LIST", sheet "DOORM
// TYPE") is the list for one room, and its name usually says which: the
// rooms whose number or type is in the sheet's name or title. Rooms the rest
// of the file already has are the last choice. Only ever a suggestion - the
// review screen shows which room the list was read as, and it can be changed.
function guessRooms(list, rooms, taken) {
  const hay = [list.label, list.title].map(roomKey).filter((h) => h.length >= 3);
  const hits = rooms.filter((r) => [roomKey(r.room_number), roomKey(r.room_type)]
    .filter((k) => k.length >= 3)
    .some((k) => hay.some((h) => mentions(h, k))));
  return hits.sort((a, b) => Number(taken.has(a.id)) - Number(taken.has(b.id)));
}

/**
 * A stored list (a dorm tab) that was saved without a room - imported before
 * anybody picked one - is given the room its tab names, when exactly one
 * room the rest of the file does not already have fits. So the export still
 * writes the dorm's people onto the dorm's tab.
 */
export function settleLists(layout, rooms) {
  const known = new Set(rooms.map((r) => r.id));
  const taken = new Set(layout.groups.filter((g) => g.roomId && known.has(g.roomId)).map((g) => g.roomId));
  layout.groups.forEach((g) => {
    if (!String(g.key).startsWith('list:') || (g.roomId && known.has(g.roomId))) return;
    const free = guessRooms(g, rooms, taken).filter((r) => !taken.has(r.id));
    g.roomId = free.length === 1 ? free[0].id : null;
    if (g.roomId) taken.add(g.roomId);
  });
  return layout;
}

/**
 * The rooms on the list and the boxes their names are in.
 *
 * @returns {Promise<{kind, groups, unknown, notes}>}
 *   groups: [{ key, roomId, label, where, title?, guesses?, slots: [{ id, grid, ref, text, where }] }]
 */
export async function readLayout(buffer, kind, rooms, givenGrids = null) {
  const roomMap = new Map(rooms.map((r) => [roomKey(r.room_number), r]));
  const typeKeys = new Set(rooms.map((r) => roomKey(r.room_type)).filter((k) => k.length >= 3));
  const groups = new Map();
  const lists = [];
  const unknown = [];
  const notes = [];

  const roomGroup = (room, where) => {
    if (!groups.has(room.id)) {
      groups.set(room.id, { key: `room:${room.id}`, roomId: room.id, label: String(room.room_number), where, slots: [] });
    }
    return groups.get(room.id);
  };

  if (kind === 'pdf') {
    const pages = await readPdf(buffer);
    const { found, unknown: unk, lists: pdfLists } = detectPdf(pages, roomMap, typeKeys);
    found.forEach(({ room, slots, where }) => {
      const g = roomGroup(room, where);
      slots.forEach((s) => g.slots.push({ id: s.id, grid: `p${s.ref.page}`, ref: s.ref, text: s.text, where }));
    });
    unk.forEach((u) => unknown.push(u));
    pdfLists.forEach((l) => lists.push({
      key: `list:${l.key}`, roomId: null, label: l.label, title: l.title, where: l.label,
      slots: l.slots.map((s) => ({ id: s.id, grid: l.key, ref: s.ref, text: s.text, where: l.label })),
    }));
    if (!pages.some((p) => p.chunks.length)) {
      notes.push('This PDF has no text in it - it is a picture of a list (a scan or a photo). Import the Excel or Word file it was made from, or type the names in a sheet.');
    }
  } else {
    const grids = givenGrids
      || (kind === 'xlsx' ? await readXlsx(buffer) : kind === 'docx' ? await readDocx(buffer) : readCsv(buffer));
    const where = (grid, r, c) => (kind === 'docx' ? `${grid.label}, row ${r + 1}` : `${grid.label} ${a1(r, c)}`);
    const slotOf = (grid) => (s) => ({
      id: `${grid.key}!${s.r},${s.c}`,
      grid: grid.key,
      ref: s.ref ?? (kind === 'xlsx' ? a1(s.r, s.c) : { r: s.r, c: s.c }),
      text: s.text,
      where: where(grid, s.r, s.c),
    });
    // Every tab of a workbook, every table of a document - the dorm's list
    // is often a tab of its own.
    grids.forEach((grid) => {
      const { found, unknown: unk, list } = detectGrid(grid, roomMap, typeKeys);
      found.forEach(({ room, slots }) => {
        const g = roomGroup(room, grid.label);
        slots.forEach((s) => g.slots.push(slotOf(grid)(s)));
      });
      unk.forEach((u) => unknown.push({ text: u.text, where: where(grid, u.r, u.c) }));
      if (list) {
        lists.push({
          key: `list:${grid.key}`, roomId: null, label: grid.label, title: grid.title || gridTitle(grid), where: grid.label,
          slots: list.slots.map(slotOf(grid)),
          // Lines below the last, made into slots on request (kind permitting:
          // a Word table has no rows past its last).
          more: list.more && kind !== 'docx' ? (count) => list.more(count).map(slotOf(grid)) : null,
          loose: !!list.loose,
        });
      }
      if (!found.length && !list && grid.cells.size > 0) {
        notes.push(`${grid.label}: no room numbers from this event and no numbered list were found on it, so it was left as it is.`);
      }
    });
  }

  // A box can only be one room's. If two rooms claim the same one (two
  // room numbers sharing a row), the first keeps it.
  const seen = new Set();
  const roomGroups = [...groups.values()].map((g) => ({
    ...g,
    slots: g.slots.filter((s) => (seen.has(s.id) ? false : seen.add(s.id))),
  })).sort(byRoomNumber);

  const taken = new Set(roomGroups.map((g) => g.roomId));
  const kept = lists.filter((l) => {
    l.slots = l.slots.filter((s) => !seen.has(s.id));
    const guesses = guessRooms(l, rooms, taken);
    l.guesses = guesses.map((r) => r.id);
    const free = guesses.filter((r) => !taken.has(r.id));
    if (free.length === 1) l.roomId = free[0].id;

    // Names down a tab with nothing else to go on - no numbers, no header -
    // are only taken as a room's list when the tab is named for the room.
    // Otherwise a notes tab could be read as somebody's room.
    if (l.loose && !l.roomId) {
      notes.push(`${l.label}: has names on it, but neither the tab's name nor its title says which room they are for, so it was left as it is. Rename the tab after its room (its room number or room type) and import again - or number the lines 1, 2, 3 and pick the room on the next screen.`);
      return false;
    }
    // A list with fewer lines written than the room sleeps gets the lines
    // below it too, so the export has a line for everybody in the room.
    const room = rooms.find((r) => r.id === l.roomId);
    const short = room ? (Number(room.pax) || 1) - l.slots.length : 0;
    if (short > 0 && l.more) l.slots.push(...l.more(short).filter((s) => !seen.has(s.id)));
    delete l.more;
    delete l.loose;
    return l.slots.length > 0;
  });

  return { version: 1, kind, groups: [...roomGroups, ...kept], unknown, notes };
}

/**
 * Every name on the list, matched. Each box gets entries - usually one, one
 * per name when a box has several - with an id the apply step answers by.
 *
 * @param {Array<{id, name, entitled}>} people everybody on the event, not cancelled
 */
export function readNames(layout, people) {
  const index = nameIndex(people);
  layout.groups.forEach((g) => g.slots.forEach((s) => {
    s.entries = readBox(s.text, index).map((e, k) => ({ id: `${s.id}#${k}`, ...e }));
  }));
  return layout;
}

/**
 * What to write, box by box, for the people in each room now.
 *
 * Somebody still in the room keeps the box they were imported in; the rest
 * fill the empty boxes in the order they were given the room; a box the
 * import found two names in takes two. A room with more people than boxes
 * has the extra names added to its last box, and is reported, rather than
 * leaving anybody off the list.
 *
 * @param {object} layout as stored
 * @param {Map<string, Array<{registrationId, name}>>} guestsByRoom
 * @param {Map<string, object>} roomsById
 * @returns {{ writes: Array<{grid, ref, text}>, crowded: string[], missing: Array<{room, count}>, placed: Map<string, string[]> }}
 */
export function planWrites(layout, guestsByRoom, roomsById) {
  const writes = [];
  const crowded = [];
  const listed = new Set();
  const placed = new Map(); // slot id -> who went in it, for the next time

  const slotsByRoom = new Map();
  layout.groups.forEach((g) => {
    if (!g.roomId) return;
    if (!slotsByRoom.has(g.roomId)) slotsByRoom.set(g.roomId, []);
    slotsByRoom.get(g.roomId).push(...g.slots);
  });

  slotsByRoom.forEach((slots, roomId) => {
    listed.add(roomId);
    const people = [...(guestsByRoom.get(roomId) || [])];
    const box = new Map(slots.map((s) => [s.id, []]));
    // Where they were.
    slots.forEach((s) => (s.regIds || []).forEach((id) => {
      const at = people.findIndex((p) => p.registrationId === id);
      if (at >= 0) box.get(s.id).push(people.splice(at, 1)[0]);
    }));
    // Everybody else, into the free boxes.
    slots.forEach((s) => {
      const cap = Math.max(1, Number(s.cap) || 1);
      while (people.length && box.get(s.id).length < cap) box.get(s.id).push(people.shift());
    });
    if (people.length && slots.length) {
      box.get(slots[slots.length - 1].id).push(...people);
      crowded.push(roomsById.get(roomId)?.room_number || '?');
    }
    slots.forEach((s) => {
      const names = box.get(s.id).map((p) => p.name);
      placed.set(s.id, box.get(s.id).map((p) => p.registrationId));
      writes.push({ grid: s.grid, ref: s.ref, text: names.join(names.length > 1 ? (s.sep || boxSeparator(s.text)) : '') });
    });
  });

  const missing = [];
  guestsByRoom.forEach((people, roomId) => {
    if (!listed.has(roomId) && people.length) missing.push({ room: roomsById.get(roomId)?.room_number || '?', count: people.length });
  });
  return { writes, crowded, missing, placed };
}

/** The imported file, with these writes made. */
export async function fillFile(buffer, kind, writes) {
  if (kind === 'xlsx') return fillXlsx(buffer, writes);
  if (kind === 'docx') return fillDocx(buffer, writes);
  if (kind === 'csv') return fillCsv(buffer, writes);
  if (kind === 'pdf') return fillPdf(buffer, writes);
  throw new Error(`Cannot write a .${kind} file`);
}

export { blankRoomList } from './blank';
