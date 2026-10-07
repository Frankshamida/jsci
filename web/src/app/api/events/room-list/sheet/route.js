import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createRoomSheet, getSheetStatus, stopRoomSheet, syncRoomSheet } from '@/lib/roomList/liveSheet';
import { linkOwnSheet, ownSheetStatus, rereadOwnSheet, scriptFor, unlinkOwnSheet } from '@/lib/roomList/ownSheet';

// Accommodation > Live sheet: a Google Sheet of the rooming list that the
// system keeps up to date - the user's own sheet (lib/roomList/ownSheet.js),
// or one the system makes (lib/roomList/liveSheet.js).
//
//   GET  ?eventId&actorId              both sheets' link and state
//   GET  ?eventId&actorId&script=1     the script to paste into your own sheet
//   POST { eventId, actorId, action }
//        own-link { hookUrl, confirm }  connect your own sheet
//        own-reread                     read its layout again
//        own-unlink                     stop writing to it
//        create                         make a sheet
//        stop                           stop writing to the made sheet
//        sync                           update both now, every name box
//
// Admin and Super Admin only: the sheets are lists of people's names.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('id, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

const MIGRATIONS = [
  [/event_room_sheet_links/i, 'event_room_sheet_links.sql'],
  [/sheet_(id|url|synced_at|error|mode)/i, 'event_room_list_sheet.sql'],
  [/event_room_lists/i, 'event_room_lists.sql'],
];
const explain = (error) => {
  const msg = error?.message || '';
  const hit = MIGRATIONS.find(([re]) => re.test(msg));
  if (hit) return `The live Google Sheet needs a migration: run supabase/migrations/${hit[1]} in the Supabase SQL editor, then try again.`;
  return msg || 'Something went wrong';
};

// Each one on its own, so a migration not yet run for one does not hide the other.
async function statusOf(eventId) {
  const [made, own] = await Promise.all([
    getSheetStatus(eventId).then((data) => ({ data }), (error) => ({ error: explain(error) })),
    ownSheetStatus(eventId).then((data) => ({ data }), (error) => ({ error: explain(error) })),
  ]);
  return { made: made.data || null, madeError: made.error || null, own: own.data || null, ownError: own.error || null };
}

const ok = (data, message) => NextResponse.json({ success: true, data, message });
const fail = (message, status = 400, data) => NextResponse.json({ success: false, message, data }, { status });

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) return fail('eventId required');
    if (!(await verifyEventManager(searchParams.get('actorId')))) return fail('Access denied. Admins only.', 403);
    if (searchParams.get('script')) return ok({ script: scriptFor(eventId) });
    return ok(await statusOf(eventId));
  } catch (error) {
    return fail(explain(error), 500);
  }
}

export async function POST(request) {
  let eventId = '';
  try {
    const body = await request.json();
    const actor = await verifyEventManager(body.actorId);
    if (!actor) return fail('Access denied. Admins only.', 403);
    eventId = String(body.eventId || '');
    if (!eventId) return fail('Choose an event first');

    switch (body.action) {
      case 'own-link': {
        const result = await linkOwnSheet(eventId, actor, { hookUrl: body.hookUrl, confirm: !!body.confirm });
        if (result.needsConfirm) return ok({ ...(await statusOf(eventId)), confirm: result });
        return ok({ ...(await statusOf(eventId)), linked: result }, `Connected to "${result.title}". It now shows the system's rooms, and keeps up by itself.`);
      }
      case 'own-reread': {
        const result = await rereadOwnSheet(eventId, actor);
        return ok({ ...(await statusOf(eventId)), linked: result }, `"${result.title}" read again - ${result.roomsFound} rooms found on it.`);
      }
      case 'own-unlink':
        await unlinkOwnSheet(eventId);
        return ok(await statusOf(eventId), 'Disconnected. Your sheet keeps the names it has now; the system no longer writes to it.');
      case 'create':
        await createRoomSheet(eventId, actor);
        return ok(await statusOf(eventId), 'The live Google Sheet is ready. Send its link to whoever needs the list.');
      case 'stop':
        await stopRoomSheet(eventId);
        return ok(await statusOf(eventId), 'Live updates stopped. The sheet is still in Google Drive, as it was - delete it there if nobody needs it.');
      case 'sync': {
        const result = await syncRoomSheet(eventId, { full: true });
        const data = await statusOf(eventId);
        if (result.skipped) return fail('This event has no live Google Sheet yet.', 400, data);
        if (!result.ok) return fail(result.error, 502, data);
        return ok(data, 'The Google Sheet is up to date.');
      }
      default:
        return fail('Unknown action');
    }
  } catch (error) {
    let data;
    try { data = eventId ? await statusOf(eventId) : undefined; } catch { data = undefined; }
    return fail(explain(error), 500, data);
  }
}
