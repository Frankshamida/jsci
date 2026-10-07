import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  MAX_BYTES, MIME, blankRoomList, fileKind, fillFile, planWrites, readLayout, readNames, settleLists,
} from '@/lib/roomList';
import { guestsByRoom, loadGuests, loadHolds, loadPeople, loadRooms } from '@/lib/roomList/data';
import { queueRoomSheetSync } from '@/lib/roomList/liveSheet';

// The hotel's rooming list, in and out.
//
//   POST step=preview  read a file (or a Google Sheets / Docs link), find its
//                      rooms and match every name on it. Saves NOTHING - the
//                      answer is for a person to look at.
//   POST step=apply    the same file again, with what that person decided for
//                      each name. Checked again here, all of it, and only then
//                      written: the assignments, and the file itself so it can
//                      be exported.
//   GET  download=1    the file as imported, with today's names in it.
//
// Admin and Super Admin only, like every other write to the rooms.
//
// Nothing here assigns a name that a person did not confirm. The preview
// marks a name "matched" only when it is exactly somebody's name and that
// somebody paid for a bed; anything else - a near spelling, two people with
// the same name, a name nobody has - arrives at apply unpicked unless the
// person picked it. And apply takes only what it was sent.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, firstname, lastname, role')
      .eq('id', actorId)
      .single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

const explain = (error) => {
  const msg = error?.message || '';
  if (/event_room_lists/i.test(msg)) {
    return 'Importing rooming lists needs its migration: run supabase/migrations/event_room_lists.sql in the Supabase SQL editor, then try again.';
  }
  if (/event_room_guests/i.test(msg)) {
    return 'Room assignment needs its migration: run supabase/migrations/event_room_guests.sql in the Supabase SQL editor, then try again.';
  }
  if (/event_rooms/i.test(msg)) {
    return 'Accommodation needs its migration: run supabase/migrations/event_rooms.sql in the Supabase SQL editor, then try again.';
  }
  return msg || 'Something went wrong';
};

const fail = (message, status = 400, extra = {}) => NextResponse.json({ success: false, message, ...extra }, { status });

// ---- What the event has ----


// ---- Getting the file ----

// A Google Sheets / Docs / Drive link, as the file Google will hand over for
// it. Only Google's own hosts, and only the export address built here - the
// server never fetches an address somebody typed.
function googleExportUrl(link) {
  let u;
  try { u = new URL(String(link || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(docs|drive)\.google\.com$/i.test(u.hostname)) return null;
  const id = (u.pathname.match(/\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] || u.searchParams.get('id');
  if (!id || !/^[A-Za-z0-9_-]{20,}$/.test(id)) return null;
  if (/\/spreadsheets\//.test(u.pathname)) return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, name: 'Google Sheet.xlsx' };
  if (/\/document\//.test(u.pathname)) return { url: `https://docs.google.com/document/d/${id}/export?format=docx`, name: 'Google Doc.docx' };
  return { url: `https://drive.google.com/uc?export=download&id=${id}`, name: 'Google Drive file' };
}

const NOT_SHARED = 'Google would not share that file. In Google Sheets or Docs click Share, set General access to "Anyone with the link", and try again - or download it (File > Download > .xlsx or .docx) and upload that.';

async function fetchGoogle(link) {
  const target = googleExportUrl(link);
  if (!target) throw new Error('That is not a Google Sheets, Google Docs or Google Drive link.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(target.url, { redirect: 'follow', signal: ctrl.signal });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || /text\/html/i.test(type)) throw new Error(NOT_SHARED);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('That file is over 8 MB.');
    const buffer = Buffer.from(await res.arrayBuffer());
    const cd = res.headers.get('content-disposition') || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    let name = target.name;
    try { name = star ? decodeURIComponent(star[1]) : (plain ? plain[1] : target.name); } catch { /* keep the default */ }
    return { buffer, name };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Google took too long to send the file. Try again, or download it and upload that.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function receive(form) {
  const file = form.get('file');
  if (file && typeof file !== 'string') {
    if (file.size > MAX_BYTES) throw new Error('That file is over 8 MB.');
    return { buffer: Buffer.from(await file.arrayBuffer()), name: file.name || 'Rooming list', fromLink: false };
  }
  const link = String(form.get('link') || '').trim();
  if (link) return { ...(await fetchGoogle(link)), fromLink: true };
  throw new Error('Choose a file, or paste a Google Sheets or Docs link.');
}

// The layout as the screen needs it: no file addresses, just the boxes and
// what was read in them.
const forScreen = (layout) => ({
  groups: layout.groups.map((g) => ({
    key: g.key,
    roomId: g.roomId,
    label: g.label,
    title: g.title || '',
    where: g.where,
    guesses: g.guesses || [],
    list: g.key.startsWith('list:'),
    slots: g.slots.map((s) => ({ id: s.id, text: s.text, where: s.where, entries: s.entries || [] })),
  })),
  unknown: layout.unknown,
  notes: layout.notes,
});

async function storedInfo(eventId) {
  const { data, error } = await supabaseAdmin
    .from('event_room_lists')
    .select('file_name, file_kind, imported_at')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;
  return data ? { fileName: data.file_name, kind: data.file_kind, importedAt: data.imported_at } : null;
}

// ---- GET ----

// GET ?eventId=..                         the list on file, if any
// GET ?eventId=..&download=1&actorId=..   the file, with today's names in it
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) return fail('eventId required');

    if (!searchParams.get('download')) {
      return NextResponse.json({ success: true, data: await storedInfo(eventId) });
    }

    const actor = await verifyEventManager(searchParams.get('actorId'));
    if (!actor) return fail('Access denied. Admins only.', 403);

    const [{ data: event }, rooms, guests, holds, stored] = await Promise.all([
      supabaseAdmin.from('events').select('id, title').eq('id', eventId).maybeSingle(),
      loadRooms(eventId),
      loadGuests(eventId),
      loadHolds(eventId),
      supabaseAdmin.from('event_room_lists').select('file_name, file_kind, file_data, layout').eq('event_id', eventId).maybeSingle()
        .then(({ data, error }) => { if (error) throw error; return data; }),
    ]);
    if (!event) return fail('That event could not be found', 404);
    if (!stored && rooms.length === 0) return fail('This event has no rooms yet. Add them, or import the hotel\'s list.');

    let buffer;
    let kind;
    let layout;
    let fileName;
    if (stored) {
      buffer = Buffer.from(stored.file_data, 'base64');
      kind = stored.file_kind;
      // A dorm tab saved without a room still gets the room its tab names.
      layout = settleLists(stored.layout, rooms);
      fileName = stored.file_name;
    } else {
      // Nothing imported: a list in the hotel's usual shape, made from the
      // rooms the event has.
      buffer = await blankRoomList(event, rooms);
      kind = 'xlsx';
      layout = await readLayout(buffer, 'xlsx', rooms);
      fileName = `${String(event.title || 'Event').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - Room Assignment.xlsx`;
    }

    const roomsById = new Map(rooms.map((r) => [r.id, r]));
    const plan = planWrites(layout, guestsByRoom(guests, holds), roomsById);
    const out = await fillFile(buffer, kind, plan.writes);

    const ascii = fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/"/g, "'");
    return new NextResponse(out, {
      headers: {
        'Content-Type': MIME[kind],
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
        // What the screen says once the download starts.
        'X-Room-List-Note': encodeURIComponent(JSON.stringify({
          imported: !!stored, crowded: plan.crowded, missing: plan.missing,
        })),
      },
    });
  } catch (error) {
    return fail(explain(error), 500);
  }
}

// ---- POST ----

export async function POST(request) {
  try {
    const form = await request.formData();
    const actor = await verifyEventManager(form.get('actorId'));
    if (!actor) return fail('Access denied. Admins only.', 403);
    const eventId = String(form.get('eventId') || '');
    if (!eventId) return fail('Choose an event first');
    const step = form.get('step') === 'apply' ? 'apply' : 'preview';

    // The table the file is kept in, asked first: a missing migration is
    // said before anybody's room is changed, not after.
    const probe = await supabaseAdmin.from('event_room_lists').select('event_id').limit(1);
    if (probe.error) throw probe.error;

    let got;
    try { got = await receive(form); } catch (err) { return fail(err.message); }
    let kind;
    try { kind = await fileKind(got.buffer, got.name); } catch (err) { return fail(err.message); }
    const sha = crypto.createHash('sha256').update(got.buffer).digest('hex');

    const rooms = await loadRooms(eventId);
    if (rooms.length === 0) {
      return fail('Add this event\'s rooms first. The list is read by its room numbers, so the rooms on it have to be on the event.');
    }
    let layout;
    try {
      layout = await readLayout(got.buffer, kind, rooms);
    } catch (err) {
      return fail(err?.message ? `That file could not be read: ${err.message}` : 'That file could not be read.');
    }
    const people = await loadPeople(eventId);
    readNames(layout, people);

    if (step === 'preview') {
      const guests = await loadGuests(eventId);
      return NextResponse.json({
        success: true,
        file: {
          name: got.name, kind, sha, size: got.buffer.length,
          // A linked file is handed back so the apply step sends exactly
          // the file that was looked at, not whatever the link holds by then.
          ...(got.fromLink ? { data: got.buffer.toString('base64') } : {}),
        },
        ...forScreen(layout),
        people,
        current: guests.map((g) => ({ registrationId: g.registration_id, roomId: g.room_id })),
        stored: await storedInfo(eventId),
      });
    }

    return await apply({ form, eventId, actor, got, kind, sha, rooms, layout, people });
  } catch (error) {
    return fail(explain(error), 500);
  }
}

async function apply({ form, eventId, actor, got, kind, sha, rooms, layout, people }) {
  if (String(form.get('sha') || '') !== sha) {
    return fail('This file is not the one that was checked. Check it again before assigning.', 409);
  }
  let decisions;
  try { decisions = JSON.parse(String(form.get('decisions') || '{}')); } catch { decisions = {}; }
  const picks = decisions.picks || {};
  const listRooms = decisions.lists || {};
  const removeMissing = !!decisions.removeMissing;

  const roomsById = new Map(rooms.map((r) => [r.id, r]));
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const problems = [];

  // Which room each numbered list is.
  layout.groups.forEach((g) => {
    if (!g.key.startsWith('list:')) return;
    if (Object.prototype.hasOwnProperty.call(listRooms, g.key)) g.roomId = listRooms[g.key] || null;
    if (g.roomId && !roomsById.has(g.roomId)) g.roomId = null;
  });

  // Who goes where - only what was picked.
  const wantRoom = new Map(); // registrationId -> roomId
  const seenAt = new Map(); // registrationId -> where it was first picked
  layout.groups.forEach((g) => {
    g.slots.forEach((s) => {
      s.regIds = [];
      // A box the list had two names in takes two again on export.
      s.cap = Math.max(1, (s.entries || []).length);
      (s.entries || []).forEach((e) => {
        const regId = picks[e.id];
        if (!regId) return;
        if (!g.roomId) {
          problems.push(`${e.text} (${s.where}) is on a list that has not been given a room.`);
          return;
        }
        const person = peopleById.get(regId);
        if (!person) { problems.push(`${e.text} (${s.where}): that person is not registered for this event.`); return; }
        if (!person.entitled) { problems.push(`${person.name} ${person.why}.`); return; }
        if (seenAt.has(regId)) {
          problems.push(`${person.name} is on the list twice - ${seenAt.get(regId)} and ${s.where}. Keep one.`);
          return;
        }
        seenAt.set(regId, s.where);
        wantRoom.set(regId, g.roomId);
        s.regIds.push(regId);
      });
    });
  });

  // Is there room - counted on what the rooms will hold afterwards: who is
  // in them now, less who is moving out or being taken out, plus the list.
  const [guests, holds] = await Promise.all([loadGuests(eventId), loadHolds(eventId)]);
  const leaving = new Set(guests
    .filter((g) => wantRoom.has(g.registration_id) || removeMissing)
    .map((g) => g.registration_id));
  const after = new Map();
  guests.forEach((g) => {
    if (!leaving.has(g.registration_id)) after.set(g.room_id, (after.get(g.room_id) || 0) + 1);
  });
  wantRoom.forEach((roomId) => after.set(roomId, (after.get(roomId) || 0) + 1));
  // Beds held by name take their bed too - except a hold for somebody this
  // list now gives a room, which goes.
  holds.forEach((h) => {
    if (h.registration_id && wantRoom.has(h.registration_id)) return;
    after.set(h.room_id, (after.get(h.room_id) || 0) + 1);
  });
  after.forEach((count, roomId) => {
    const room = roomsById.get(roomId);
    if (room && count > (Number(room.pax) || 1)) {
      problems.push(`Room ${room.room_number} would have ${count} people - it sleeps ${room.pax}.`);
    }
  });

  if (problems.length) {
    return fail(problems.length === 1 ? problems[0] : `${problems.length} things to fix before assigning.`, 400, { problems });
  }

  // ---- Write ----
  const now = new Date().toISOString();
  const was = new Map(guests.map((g) => [g.registration_id, g.room_id]));
  const rows = [...wantRoom.entries()]
    .filter(([regId, roomId]) => was.get(regId) !== roomId)
    .map(([regId, roomId]) => ({
      event_id: eventId, room_id: roomId, registration_id: regId, assigned_by: actor.id, assigned_at: now,
    }));
  if (rows.length) {
    const { error } = await supabaseAdmin
      .from('event_room_guests')
      .upsert(rows, { onConflict: 'event_id,registration_id', ignoreDuplicates: false });
    if (error) throw error;
  }
  // Somebody given a room no longer needs a bed held for them.
  const heldFor = holds.filter((h) => h.registration_id && wantRoom.has(h.registration_id)).map((h) => h.id);
  if (heldFor.length) {
    const { error } = await supabaseAdmin.from('event_room_holds').delete().in('id', heldFor);
    if (error) throw error;
  }
  const takenOut = removeMissing ? guests.filter((g) => !wantRoom.has(g.registration_id)) : [];
  if (takenOut.length) {
    const { error } = await supabaseAdmin
      .from('event_room_guests')
      .delete()
      .eq('event_id', eventId)
      .in('registration_id', takenOut.map((g) => g.registration_id));
    if (error) throw error;
  }

  // A room nobody is in any more loses its All Boys / All Girls / Family
  // label, as it does when the desk takes the last person out.
  const emptied = [...new Set(guests.map((g) => g.room_id))].filter((id) => !after.has(id));
  if (emptied.length) {
    try { await supabaseAdmin.from('event_rooms').update({ occupancy: null }).in('id', emptied); } catch { /* no label column yet */ }
  }

  // ---- Keep the file, and where its names go ----
  const stored = {
    version: layout.version,
    kind,
    groups: layout.groups.map((g) => ({
      key: g.key,
      roomId: g.roomId,
      label: g.label,
      title: g.title,
      where: g.where,
      slots: g.slots.map((s) => ({
        id: s.id, grid: s.grid, ref: s.ref, text: s.text, where: s.where, regIds: s.regIds, cap: s.cap,
      })),
    })),
    unknown: layout.unknown,
    notes: layout.notes,
  };
  const { error: saveErr } = await supabaseAdmin.from('event_room_lists').upsert([{
    event_id: eventId,
    file_name: got.name,
    file_kind: kind,
    file_data: got.buffer.toString('base64'),
    file_sha: sha,
    layout: stored,
    imported_at: now,
    imported_by: actor.id,
  }], { onConflict: 'event_id' });
  if (saveErr) throw saveErr;
  // A live Google Sheet takes the new file whole - its design may have changed.
  queueRoomSheetSync(eventId, { replace: true });

  const moved = rows.filter((r) => was.has(r.registration_id)).length;
  const assigned = rows.length - moved;
  const already = wantRoom.size - rows.length;
  const parts = [
    assigned ? `${assigned} assigned` : '',
    moved ? `${moved} moved` : '',
    already ? `${already} already in their room` : '',
    takenOut.length ? `${takenOut.length} taken out` : '',
  ].filter(Boolean);
  return NextResponse.json({
    success: true,
    counts: { assigned, moved, already, takenOut: takenOut.length },
    message: `${got.name} imported${parts.length ? ` - ${parts.join(', ')}` : ' - no names were assigned'}.`,
  });
}
