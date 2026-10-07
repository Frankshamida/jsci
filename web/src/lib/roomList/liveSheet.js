// The rooming list as a live Google Sheet.
//
// Made once, from the event's rooming list - the hotel's own file, both tabs,
// converted by Google so it keeps its design - in the Google account this
// app is connected to (lib/googleDrive), shared as "anyone with the link can
// view". After that, every change to who is in which room is written into it:
// the desk assigning a card, a move, a removal, an import, a registration
// cancelled or renamed. The link the hotel was sent is always the list.
//
// HOW A CHANGE REACHES THE SHEET
//
//   cells   Only the name boxes are written (Google Sheets API). The sheet's
//           design is never touched, and anybody looking at it sees the names
//           change where they sit. Needs the Google Sheets API switched on in
//           the Google Cloud project the app's login belongs to.
//   upload  When that API is off, the sheet's contents are replaced with the
//           filled file instead (Google Drive, which the app already uses).
//           Same result, a little slower, and the page reloads for whoever
//           has it open.
//
// The system is the list: a name typed into the sheet is written over at the
// next change. Changes that come in a burst - a queue at the desk - are sent
// as one update a moment after the last of them.
import { supabaseAdmin } from '@/lib/supabase';
import { googleFetch } from '@/lib/googleDrive';
import { a1 } from './grid';
import { MIME, blankRoomList, fillFile, planWrites, readLayout, settleLists } from './index';
import { readXlsx } from './xlsx';
import { guestsByRoom, loadGuests, loadHolds, loadRooms } from './data';
import { syncOwnSheet } from './ownSheet';

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const FOLDER = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const SETTLE_MS = 1500;

/** The kinds of list a Google Sheet can be made from. */
export const LIVE_KINDS = ['xlsx', 'csv'];
const KIND_LABEL = { xlsx: 'Excel', csv: 'CSV', docx: 'Word', pdf: 'PDF' };
const uploadType = (kind) => (kind === 'csv' ? 'text/csv' : MIME.xlsx);

const STATUS_FIELDS = 'event_id, file_name, file_kind, sheet_id, sheet_url, sheet_synced_at, sheet_error, sheet_mode';
const FULL_FIELDS = `${STATUS_FIELDS}, file_data, layout`;

async function readList(eventId, fields = FULL_FIELDS) {
  const { data, error } = await supabaseAdmin.from('event_room_lists').select(fields).eq('event_id', eventId).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveList(eventId, patch) {
  const { error } = await supabaseAdmin.from('event_room_lists').update(patch).eq('event_id', eventId);
  if (error) throw error;
}

/** What the screen shows about the live sheet. */
export function sheetStatus(list) {
  if (!list) return { fileName: null, kind: null, url: null };
  return {
    fileName: list.file_name,
    kind: list.file_kind,
    url: list.sheet_id ? list.sheet_url : null,
    syncedAt: list.sheet_synced_at || null,
    error: list.sheet_error || null,
    mode: list.sheet_mode || null,
  };
}

export async function getSheetStatus(eventId) {
  return sheetStatus(await readList(eventId, STATUS_FIELDS));
}

// ---- Talking to Google ----

async function bodyOf(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 300) }; }
}

function googleError(res, body, what) {
  if (res.status === 404) {
    return new Error('The Google Sheet is gone - it was deleted, or the connected Google account lost access to it. Stop live updates and make a new one.');
  }
  const err = new Error(`${what}: ${body?.error?.message || body?.raw || `HTTP ${res.status}`}`);
  // The Sheets API switched off in the Cloud project, or the login not
  // allowed to use it: write by uploading instead.
  if (/SERVICE_DISABLED|has not been used|is disabled|accessNotConfigured|insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i
    .test(JSON.stringify(body?.error || body || ''))) err.useUpload = true;
  return err;
}

async function createSheetFile(name, kind, buffer) {
  const boundary = `roomlist${Date.now().toString(36)}`;
  const meta = { name, mimeType: SHEET_MIME, ...(FOLDER ? { parents: [FOLDER] } : {}) };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${boundary}\r\nContent-Type: ${uploadType(kind)}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await googleFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
    60000,
  );
  const made = await bodyOf(res);
  if (!res.ok) throw googleError(res, made, 'Google Drive would not make the sheet');

  // Anyone with the link can look; nobody but the app's account can edit.
  let shareNote = null;
  const share = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${made.id}/permissions?supportsAllDrives=true`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) },
  );
  if (!share.ok) {
    shareNote = 'The sheet was made, but Google would not share it as "anyone with the link" - the Google account\'s sharing settings forbid it. Open it and share it with the people who need it.';
  }
  return { id: made.id, url: made.webViewLink || `https://docs.google.com/spreadsheets/d/${made.id}/edit`, shareNote };
}

async function replaceSheetContents(sheetId, kind, buffer) {
  const res = await googleFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${sheetId}?uploadType=media&supportsAllDrives=true&fields=id`,
    { method: 'PATCH', headers: { 'Content-Type': uploadType(kind) }, body: buffer },
    60000,
  );
  if (!res.ok) throw googleError(res, await bodyOf(res), 'Google Drive would not update the sheet');
}

// The sheet's tab for each part of the file. A converted workbook keeps its
// tab names; a CSV becomes one tab, named by Google.
async function tabNames(kind, buffer, sheetId) {
  if (kind === 'xlsx') return new Map((await readXlsx(buffer)).map((g) => [g.key, g.label]));
  const res = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`);
  const body = await bodyOf(res);
  if (!res.ok) throw googleError(res, body, 'Google Sheets');
  return new Map([['csv', body.sheets?.[0]?.properties?.title || 'Sheet1']]);
}

async function writeCells(sheetId, kind, buffer, writes) {
  const tabs = await tabNames(kind, buffer, sheetId);
  const quote = (t) => `'${String(t).replace(/'/g, "''")}'`;
  const data = writes
    .filter((w) => tabs.has(w.grid))
    .map((w) => ({
      range: `${quote(tabs.get(w.grid))}!${typeof w.ref === 'string' ? w.ref : a1(w.ref.r, w.ref.c)}`,
      values: [[w.text || '']],
    }));
  if (!data.length) return;
  // RAW: a name is written as a name, never read as a formula.
  const res = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data }) },
  );
  if (!res.ok) throw googleError(res, await bodyOf(res), 'Google Sheets');
}

// ---- The list a sheet is made from ----

// The default list - every room, a line per bed - follows the rooms: when one
// is added, renamed or removed, the list is made again.
const roomsSignature = (rooms) => rooms
  .map((r) => `${r.id}:${r.room_number}:${r.room_type}:${r.pax}`).sort().join('|');

async function makeDefaultList(event, rooms) {
  const buffer = await blankRoomList(event, rooms);
  const layout = await readLayout(buffer, 'xlsx', rooms);
  layout.generated = true;
  layout.roomsSig = roomsSignature(rooms);
  const title = String(event?.title || 'Event').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return { file_name: `${title} - Room Assignment.xlsx`, file_kind: 'xlsx', buffer, layout };
}

function planFor(layout, rooms, guests, holds) {
  return planWrites(settleLists(layout, rooms), guestsByRoom(guests, holds), new Map(rooms.map((r) => [r.id, r])));
}

const sheetTitle = (fileName, eventTitle) => {
  const base = String(fileName || 'Rooming list').replace(/\.(xlsx|xlsm|csv)$/i, '');
  return eventTitle && !base.toLowerCase().includes(String(eventTitle).toLowerCase()) ? `${base} - ${eventTitle}` : base;
};

/**
 * Make the live sheet. Uses the event's imported list; with none, the
 * default list of every room. Returns the status, with the link.
 */
export async function createRoomSheet(eventId, actor) {
  const { data: event } = await supabaseAdmin.from('events').select('id, title').eq('id', eventId).maybeSingle();
  if (!event) throw new Error('That event could not be found');
  const [rooms, guests, holds] = await Promise.all([loadRooms(eventId), loadGuests(eventId), loadHolds(eventId)]);

  let list = await readList(eventId);
  if (list?.sheet_id) return sheetStatus(list);
  if (!list) {
    if (!rooms.length) throw new Error('Add the event\'s rooms first - the sheet lists them.');
    const made = await makeDefaultList(event, rooms);
    const { error } = await supabaseAdmin.from('event_room_lists').insert([{
      event_id: eventId,
      file_name: made.file_name,
      file_kind: made.file_kind,
      file_data: made.buffer.toString('base64'),
      file_sha: '-',
      layout: made.layout,
      imported_by: actor?.id || null,
    }]);
    if (error) throw error;
    list = await readList(eventId);
  }
  if (!LIVE_KINDS.includes(list.file_kind)) {
    throw new Error(`A Google Sheet can be made from an Excel or CSV list, and this event's list is ${list.file_name} (${KIND_LABEL[list.file_kind] || list.file_kind}). Import the Excel version of the hotel's list first.`);
  }

  const buffer = Buffer.from(list.file_data, 'base64');
  const plan = planFor(list.layout, rooms, guests, holds);
  const made = await createSheetFile(sheetTitle(list.file_name, event.title), list.file_kind, await fillFile(buffer, list.file_kind, plan.writes));

  // Can it be written box by box? Tried now, so the screen can say.
  let mode = 'cells';
  try { await writeCells(made.id, list.file_kind, buffer, plan.writes); } catch (err) {
    if (!err.useUpload) throw err;
    mode = 'upload';
  }
  await saveList(eventId, {
    sheet_id: made.id,
    sheet_url: made.url,
    sheet_synced_at: new Date().toISOString(),
    sheet_error: made.shareNote,
    sheet_mode: mode,
  });
  return sheetStatus(await readList(eventId, STATUS_FIELDS));
}

/**
 * Bring every live sheet of the event up to date: the one the system made,
 * and the user's own connected sheet. Never throws.
 *   replace  the made sheet takes the whole file (a new list was imported)
 *   full     the user's sheet has every name box rewritten, not just changes
 */
export async function syncRoomSheet(eventId, { replace = false, full = false } = {}) {
  const [made, own] = await Promise.all([syncMadeSheet(eventId, { replace }), syncOwnSheet(eventId, { full })]);
  const ran = [made, own].filter((r) => !r.skipped);
  if (!ran.length) return { skipped: true };
  const failed = ran.find((r) => !r.ok);
  return failed ? { ok: false, error: failed.error, made, own } : { ok: true, made, own };
}

// The sheet the system made. replace: write the whole file, not just the
// name boxes. A failure is kept on the list for the screen to show.
async function syncMadeSheet(eventId, { replace = false } = {}) {
  let head;
  try {
    head = await readList(eventId, 'sheet_id');
  } catch {
    return { skipped: true }; // no list table, or no sheet columns yet
  }
  if (!head?.sheet_id) return { skipped: true };

  let list;
  try {
    list = await readList(eventId);
    const [rooms, guests, holds] = await Promise.all([loadRooms(eventId), loadGuests(eventId), loadHolds(eventId)]);

    if (list.layout?.generated && list.layout.roomsSig !== roomsSignature(rooms)) {
      const { data: event } = await supabaseAdmin.from('events').select('id, title').eq('id', eventId).maybeSingle();
      const made = await makeDefaultList(event, rooms);
      await saveList(eventId, { file_data: made.buffer.toString('base64'), layout: made.layout });
      list = { ...list, file_data: made.buffer.toString('base64'), layout: made.layout };
      replace = true;
    }
    if (!LIVE_KINDS.includes(list.file_kind)) {
      throw new Error(`The rooming list was replaced by ${list.file_name}, a ${KIND_LABEL[list.file_kind] || list.file_kind} file, which a Google Sheet cannot show. The sheet still has the last Excel list; import the Excel version to update it.`);
    }

    const buffer = Buffer.from(list.file_data, 'base64');
    const plan = planFor(list.layout, rooms, guests, holds);
    let mode = list.sheet_mode || 'cells';
    if (!replace) {
      try {
        await writeCells(list.sheet_id, list.file_kind, buffer, plan.writes);
        mode = 'cells';
      } catch (err) {
        if (!err.useUpload) throw err;
        replace = true;
        mode = 'upload';
      }
    }
    if (replace) await replaceSheetContents(list.sheet_id, list.file_kind, await fillFile(buffer, list.file_kind, plan.writes));

    await saveList(eventId, { sheet_synced_at: new Date().toISOString(), sheet_error: null, sheet_mode: mode });
    return { ok: true, mode, crowded: plan.crowded, missing: plan.missing };
  } catch (err) {
    const message = String(err?.message || 'The Google Sheet could not be updated').slice(0, 500);
    try { await saveList(eventId, { sheet_error: message }); } catch { /* nothing more to do */ }
    return { ok: false, error: message };
  }
}

/** Stop writing to the sheet. The sheet itself stays in Google Drive. */
export async function stopRoomSheet(eventId) {
  await saveList(eventId, { sheet_id: null, sheet_url: null, sheet_synced_at: null, sheet_error: null, sheet_mode: null });
}

// ---- Real time ----
// Kept on globalThis so every route in this server process shares one queue,
// and a burst of changes to one event becomes one update.
const queue = globalThis.__roomSheetQueue || (globalThis.__roomSheetQueue = new Map());

/**
 * Update the event's live sheet soon, in the background. Safe to call after
 * any change to rooms or guests - it does nothing for an event with no sheet.
 */
export function queueRoomSheetSync(eventId, { replace = false } = {}) {
  if (!eventId) return;
  const waiting = queue.get(eventId);
  if (waiting) {
    waiting.again = true;
    waiting.replace = waiting.replace || replace;
    return;
  }
  const state = { again: true, replace };
  queue.set(eventId, state);
  (async () => {
    try {
      while (state.again) {
        // Wait for the burst to finish first: everything that arrives while
        // waiting goes out in this one update, and only a change made while
        // it is being sent calls for another.
        await new Promise((r) => { setTimeout(r, SETTLE_MS); });
        state.again = false;
        const whole = state.replace;
        state.replace = false;
        await syncRoomSheet(eventId, { replace: whole });
      }
    } catch (err) {
      console.warn('[roomSheet] update failed:', err?.message);
    } finally {
      queue.delete(eventId);
    }
  })();
}
