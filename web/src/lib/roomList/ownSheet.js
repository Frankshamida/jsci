// The rooming list in the user's OWN Google Sheet, kept up to date.
//
// The system cannot edit a sheet in somebody else's Google account, and an
// API key can only read. So the sheet is given a small script of its own
// (Extensions > Apps Script, deployed as a web app - SCRIPT below), and the
// system calls it:
//
//   read   once, when the sheet is connected: every tab's cells and merged
//          boxes. The rooms and their name boxes are found from that exactly
//          as they are from an imported file (index.js) - by the event's own
//          room numbers, and a numbered list on a tab of its own for the dorm.
//   write  whenever who is in which room changes: just the name boxes whose
//          name changed. The sheet's design, its other cells, its sharing -
//          all of it stays the user's.
//
// The script answers only requests carrying its secret. The secret is made
// from the event and a key only the server has, so it is never stored, and a
// script copied for one event is useless for another.
//
// One way, like the sheet the system makes: a name typed into the sheet is
// written over at the next change - or straight away by "Update now".
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { a1 } from './grid';
import { planWrites, readLayout, settleLists } from './index';
import { guestsByRoom, loadGuests, loadHolds, loadRooms } from './data';

const SCRIPT = `/**
 * @OnlyCurrentDoc
 *
 * SanctuaryHub - live rooming list.
 * Lets the SanctuaryHub system write who is in which room into THIS sheet.
 *
 *  1. Replace everything in this file with this script, then Save.
 *  2. Deploy > New deployment > (gear icon) Web app.
 *     Execute as: Me.   Who has access: Anyone.   Deploy, and allow access.
 *  3. Copy the Web app URL (it ends in /exec) into the system.
 *
 * It answers only requests carrying the secret below, and it can only
 * read and write this one spreadsheet.
 */
const SECRET = '__SECRET__';

function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: 'bad request' }); }
  if (req.secret !== SECRET) return reply({ ok: false, error: 'wrong secret' });
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (req.action === 'read') {
    return reply({ ok: true, version: 1, title: book.getName(), url: book.getUrl(), tabs: readTabs(book) });
  }
  if (req.action === 'write') return reply(writeNames(book, req.writes || []));
  return reply({ ok: false, error: 'unknown action' });
}

function doGet() {
  return reply({ ok: true, script: 'SanctuaryHub rooming list', version: 1 });
}

function readTabs(book) {
  return book.getSheets().filter(function (s) { return !s.isSheetHidden(); }).map(function (s) {
    const range = s.getRange(1, 1, Math.max(s.getLastRow(), 1), Math.max(s.getLastColumn(), 1));
    const merges = s.getRange(1, 1, s.getMaxRows(), s.getMaxColumns()).getMergedRanges().map(function (m) {
      return [m.getRow(), m.getColumn(), m.getNumRows(), m.getNumColumns()];
    });
    return { name: s.getName(), values: range.getDisplayValues(), formulas: range.getFormulas(), merges: merges };
  });
}

function writeNames(book, writes) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    let written = 0;
    writes.forEach(function (w) {
      const sheet = book.getSheetByName(w.tab);
      if (!sheet) return;
      let value = String(w.value == null ? '' : w.value);
      if (/^[=+\\-@]/.test(value)) value = "'" + value; // a name, never a formula
      sheet.getRange(w.a1).setValue(value);
      written += 1;
    });
    SpreadsheetApp.flush();
    return { ok: true, written: written };
  } finally {
    lock.releaseLock();
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;

const LINK_FIELDS = 'event_id, title, sheet_url, hook_url, layout, last, linked_at, synced_at, error';
const STATUS_FIELDS = 'event_id, title, sheet_url, linked_at, synced_at, error, layout';

/** The script's secret for this event: the same every time, never stored. */
export function sheetSecret(eventId) {
  const key = process.env.ROOM_SHEET_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.GOOGLE_CLIENT_SECRET || '';
  if (!key) throw new Error('The server has no key to make the script\'s secret with. Set ROOM_SHEET_SECRET in .env.local and restart.');
  return crypto.createHmac('sha256', key).update(`room-sheet:${eventId}`).digest('base64url').slice(0, 32);
}

/** The script to paste into the sheet, with this event's secret in it. */
export function scriptFor(eventId) {
  return SCRIPT.replace('__SECRET__', sheetSecret(eventId));
}

// ---- Talking to the script ----

// Only a deployed web app of Google Apps Script - the server never calls an
// address somebody typed. A bare deployment id is taken as its /exec link.
export function hookUrlOf(raw) {
  const text = String(raw || '').trim();
  if (/^AKfy[A-Za-z0-9_-]{20,}$/.test(text)) return `https://script.google.com/macros/s/${text}/exec`;
  let u;
  try { u = new URL(text); } catch { u = null; }
  const m = u && u.protocol === 'https:' && u.hostname === 'script.google.com'
    ? /^\/(?:a\/macros\/[^/]+|macros)\/s\/([A-Za-z0-9_-]{20,})\/(exec|dev)\/?$/.exec(u.pathname)
    : null;
  if (!m) {
    throw new Error('That is not the script\'s Web app URL. In Apps Script: Deploy > New deployment > Web app > Deploy, then copy the Web app URL - it looks like https://script.google.com/macros/s/.../exec');
  }
  if (m[2] === 'dev') {
    throw new Error('That is the test link (it ends in /dev), which only works while signed in to Google. Use Deploy > New deployment > Web app, and copy the Web app URL that ends in /exec.');
  }
  return `https://script.google.com${u.pathname.replace(/\/$/, '')}`;
}

async function callHook(hookUrl, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    // Apps Script answers a POST with a redirect to its result; fetch follows it.
    const res = await fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!body) {
      if (/accounts\.google\.com|ServiceLogin|signin/i.test(text) || res.status === 401 || res.status === 403) {
        throw new Error('Google asked for a sign-in before letting the system reach the script. In Apps Script: Deploy > Manage deployments > Edit (pencil) > Who has access: Anyone > Deploy.');
      }
      if (res.status === 404) {
        throw new Error('That script was not found - the deployment may have been archived. Copy the Web app URL again from Deploy > Manage deployments.');
      }
      const said = (/<title>([^<]*)<\/title>/i.exec(text) || [])[1] || (/TypeError|ReferenceError|Exception[^<]*/.exec(text) || [])[0] || `HTTP ${res.status}`;
      throw new Error(`The sheet's script did not answer properly (${said.trim().slice(0, 160)}). Check the whole script was pasted and saved, then deploy a new version.`);
    }
    if (!body.ok) {
      if (body.error === 'wrong secret') {
        throw new Error('The script in the sheet has a different secret. Copy the script from this screen again, paste it over the old one, Save, then Deploy > Manage deployments > Edit > Version: New version > Deploy.');
      }
      throw new Error(`The sheet's script said: ${body.error || 'something went wrong'}`);
    }
    return body;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('The Google Sheet took too long to answer. Try again in a moment.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// The script's answer, as the grids the room finder reads.
function gridsOf(book) {
  return (book.tabs || []).map((tab) => {
    const cells = new Map();
    let rows = 0;
    let cols = 0;
    (tab.values || []).forEach((row, r) => {
      (row || []).forEach((v, c) => {
        const text = String(v ?? '').trim();
        const formula = !!String(tab.formulas?.[r]?.[c] || '').trim();
        if (text || formula) cells.set(`${r},${c}`, { r, c, text, ref: a1(r, c), formula });
        cols = Math.max(cols, c + 1);
      });
      rows = Math.max(rows, r + 1);
    });
    const merges = (tab.merges || []).map(([row, col, nr, nc]) => ({ r1: row - 1, c1: col - 1, r2: row + nr - 2, c2: col + nc - 2 }));
    merges.forEach((m) => { rows = Math.max(rows, m.r2 + 1); cols = Math.max(cols, m.c2 + 1); });
    return { key: tab.name, label: tab.name, cells, merges, rows, cols };
  });
}

const boxKey = (s) => `${s.grid}!${s.ref}`;

// What is kept of a layout: enough to write, nothing to show.
const keep = (layout) => ({
  version: layout.version,
  groups: layout.groups.map((g) => ({
    key: g.key,
    roomId: g.roomId,
    label: g.label,
    title: g.title,
    where: g.where,
    slots: g.slots.map((s) => ({ id: s.id, grid: s.grid, ref: s.ref, text: s.text, where: s.where, regIds: s.regIds || [], cap: s.cap || 1 })),
  })),
});

async function readLink(eventId, fields = LINK_FIELDS) {
  const { data, error } = await supabaseAdmin.from('event_room_sheet_links').select(fields).eq('event_id', eventId).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveLink(eventId, patch) {
  const { error } = await supabaseAdmin.from('event_room_sheet_links').update(patch).eq('event_id', eventId);
  if (error) throw error;
}

/** What the screen shows about the connected sheet, or null. */
export async function ownSheetStatus(eventId) {
  const link = await readLink(eventId, STATUS_FIELDS);
  if (!link) return null;
  const groups = link.layout?.groups || [];
  return {
    title: link.title,
    url: link.sheet_url,
    linkedAt: link.linked_at,
    syncedAt: link.synced_at,
    error: link.error,
    rooms: groups.filter((g) => g.roomId).length,
    unplaced: groups.filter((g) => !g.roomId).map((g) => g.label),
  };
}

/**
 * Connect the user's sheet: read it, find the rooms on it, and write the
 * names in. When the sheet already has names written in it and confirm is
 * not set, nothing is saved - the answer says how many, so the person can
 * choose to import them first.
 */
export async function linkOwnSheet(eventId, actor, { hookUrl, confirm = false }) {
  const hook = hookUrlOf(hookUrl);
  const book = await callHook(hook, { secret: sheetSecret(eventId), action: 'read' });
  const rooms = await loadRooms(eventId);
  if (!rooms.length) throw new Error('Add this event\'s rooms first - the sheet is read by its room numbers.');

  const layout = settleLists(await readLayout(null, 'xlsx', rooms, gridsOf(book)), rooms);
  const placedGroups = layout.groups.filter((g) => g.roomId);
  if (!placedGroups.length) {
    throw new Error(`No room numbers from this event were found on "${book.title}". The sheet has to show the event's room numbers (204, 205 ...) with a line for each bed beside them.`);
  }
  const slots = layout.groups.flatMap((g) => g.slots);
  const written = slots.filter((s) => s.text).length;
  const [guests, holds] = await Promise.all([loadGuests(eventId), loadHolds(eventId)]);
  const summary = {
    title: book.title,
    roomsFound: placedGroups.length,
    roomsTotal: rooms.length,
    unknown: layout.unknown,
    unplaced: layout.groups.filter((g) => !g.roomId).map((g) => g.label),
  };
  if (written > 0 && !confirm) {
    return { needsConfirm: true, written, inRooms: guests.length + holds.length, ...summary };
  }

  const { error } = await supabaseAdmin.from('event_room_sheet_links').upsert([{
    event_id: eventId,
    title: book.title || null,
    sheet_url: book.url,
    hook_url: hook,
    layout: keep(layout),
    // What the boxes hold now, so the first update writes only what differs.
    last: Object.fromEntries(slots.map((s) => [boxKey(s), s.text || ''])),
    linked_at: new Date().toISOString(),
    linked_by: actor?.id || null,
    synced_at: null,
    error: null,
  }], { onConflict: 'event_id' });
  if (error) throw error;

  const result = await syncOwnSheet(eventId);
  if (!result.ok) throw new Error(result.error);
  return { linked: true, ...summary, written: result.written };
}

/** Read the connected sheet's layout again (rows or rooms were added to it). */
export async function rereadOwnSheet(eventId, actor) {
  const link = await readLink(eventId, 'hook_url');
  if (!link) throw new Error('This event has no Google Sheet connected.');
  return linkOwnSheet(eventId, actor, { hookUrl: link.hook_url, confirm: true });
}

/**
 * Bring the connected sheet up to date. full: write every name box, not only
 * the ones whose name changed (puts back anything typed into the sheet).
 * Never throws: a failure is kept on the link for the screen to show.
 */
export async function syncOwnSheet(eventId, { full = false } = {}) {
  let link;
  try {
    link = await readLink(eventId);
  } catch {
    return { skipped: true }; // no table yet
  }
  if (!link) return { skipped: true };
  try {
    const [rooms, guests, holds] = await Promise.all([loadRooms(eventId), loadGuests(eventId), loadHolds(eventId)]);
    const layout = settleLists(link.layout, rooms);
    const plan = planWrites(layout, guestsByRoom(guests, holds), new Map(rooms.map((r) => [r.id, r])));
    const last = link.last || {};
    const changed = full ? plan.writes : plan.writes.filter((w) => (last[boxKey(w)] ?? '') !== (w.text || ''));
    if (changed.length) {
      await callHook(link.hook_url, {
        secret: sheetSecret(eventId),
        action: 'write',
        writes: changed.map((w) => ({ tab: w.grid, a1: w.ref, value: w.text || '' })),
      });
    }
    // Who is in which box now - they stay there next time.
    layout.groups.forEach((g) => g.slots.forEach((s) => { s.regIds = plan.placed.get(s.id) || []; }));
    await saveLink(eventId, {
      layout: keep(layout),
      last: Object.fromEntries(plan.writes.map((w) => [boxKey(w), w.text || ''])),
      synced_at: new Date().toISOString(),
      error: null,
    });
    return { ok: true, written: changed.length, crowded: plan.crowded, missing: plan.missing };
  } catch (err) {
    const message = String(err?.message || 'The Google Sheet could not be updated').slice(0, 500);
    try { await saveLink(eventId, { error: message }); } catch { /* nothing more to do */ }
    return { ok: false, error: message };
  }
}

/** Stop writing to the sheet. The sheet and its script stay as they are. */
export async function unlinkOwnSheet(eventId) {
  const { error } = await supabaseAdmin.from('event_room_sheet_links').delete().eq('event_id', eventId);
  if (error) throw error;
}
