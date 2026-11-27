// Ministry Meetings.
//
//   GET    ?actorId=..&view=upcoming|past      the meetings this account sees,
//                                              with who is going (see meetingsServer)
//   POST   { actorId, title, description, ministries, startsAt, location }
//          schedules one; the members of those ministries get a notice
//   POST   { actorId, action: 'remind', id }   nudges everyone who has not answered
//   PUT    { actorId, id, ...changes }         changes one; people going hear if
//                                              the time or place moved
//   DELETE ?actorId=..&id=..[&mode=hard]       cancels one (hard: removes it)
//
// Every message is written to be shown to the person as it is.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadActor, canSchedule, canRun, canSee, loadPeople, loadRsvps, shapeMeeting, invitedTo, notify, fullName,
} from '@/lib/meetingsServer';
import {
  MEETING_LIMITS, MEETING_STATUSES, STILL_ON_MS, splitMinistries, ministryKey, whenLabel, inputToIso,
} from '@/lib/meetings';
import { getUserRoles } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const ok = (body) => NextResponse.json({ success: true, ...body });
const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const oops = (where, error) => {
  console.error(`meetings ${where}:`, error?.message || error);
  return bad('Something went wrong on our side. Please try again in a moment.', 500);
};

const first = (name) => String(name || '').split(' ')[0] || 'the organizer';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The time sent: an ISO instant, or a datetime-local value read as Manila time.
function readTime(body) {
  const raw = body.startsAt ?? body.meetingDate;
  if (!raw) return { iso: null };
  const iso = inputToIso(raw) || (Number.isNaN(new Date(raw).getTime()) ? null : new Date(raw).toISOString());
  return iso ? { iso } : { error: 'That date and time could not be read. Please pick it again.' };
}

function checkTime(iso, { mustBeAhead }) {
  const t = new Date(iso).getTime();
  if (mustBeAhead && t < Date.now() - 5 * 60 * 1000) return 'That time has already passed. Please pick a time later than now.';
  if (t > Date.now() + 2 * 365 * 86400000) return 'That is more than two years away. Please pick a nearer date.';
  return null;
}

function checkText(body) {
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const location = String(body.location ?? '').trim();
  if (body.title !== undefined && !title) return { error: 'Please give the meeting a title.' };
  if (title.length > MEETING_LIMITS.title) return { error: `Please keep the title under ${MEETING_LIMITS.title} characters.` };
  if (description.length > MEETING_LIMITS.description) return { error: `Please keep the details under ${MEETING_LIMITS.description} characters.` };
  if (location.length > MEETING_LIMITS.location) return { error: `Please keep the place under ${MEETING_LIMITS.location} characters.` };
  return { title, description, location };
}

async function ministryNames() {
  const { data } = await supabaseAdmin.from('ministries').select('name').order('name', { ascending: true });
  return splitMinistries((data || []).map((m) => m.name));
}

// Spelled as the ministries table spells them, whatever the browser sent.
async function readMinistries(value) {
  const asked = splitMinistries(value);
  const known = await ministryNames();
  const byKey = new Map(known.map((n) => [ministryKey(n), n]));
  return asked.map((n) => byKey.get(ministryKey(n)) || n);
}

async function shapeOne(row, viewer) {
  const [people, rsvps] = await Promise.all([loadPeople(), loadRsvps([row.id])]);
  return shapeMeeting(row, { viewer, people, rsvps: rsvps.get(row.id) || [] });
}

// ---------------------------------------------------------------- GET
export async function GET(request) {
  try {
    const sp = new URL(request.url).searchParams;
    const who = await loadActor(sp.get('actorId'));
    if (who.error) return bad(who.error, who.status);
    const { user } = who;
    const past = sp.get('view') === 'past';
    const cutoff = new Date(Date.now() - STILL_ON_MS).toISOString();

    let q = supabaseAdmin.from('ministry_meetings').select('*');
    q = past
      ? q.lt('meeting_date', cutoff).gte('meeting_date', new Date(Date.now() - 180 * 86400000).toISOString())
        .order('meeting_date', { ascending: false }).limit(60)
      : q.gte('meeting_date', cutoff).order('meeting_date', { ascending: true }).limit(100);
    const { data, error } = await q;
    if (error) throw error;

    const rows = (data || []).filter((r) => canSee(user, r));
    const [people, rsvps] = await Promise.all([loadPeople(), loadRsvps(rows.map((r) => r.id))]);
    const byId = new Map(people.map((u) => [u.id, u]));
    const meetings = rows.map((r) => shapeMeeting(r, { viewer: user, people, byId, rsvps: rsvps.get(r.id) || [] }));
    const scheduler = canSchedule(user);
    let ministries = [];
    const members = {};
    if (scheduler) {
      // For the form's "N people will get a notice": who is in each ministry.
      ministries = await ministryNames();
      ministries.forEach((name) => {
        members[ministryKey(name)] = invitedTo({ ministry: name }, people).map((u) => u.id);
      });
    }
    return ok({ data: meetings, canSchedule: scheduler, ministries, members });
  } catch (error) {
    return oops('GET', error);
  }
}

// ---------------------------------------------------------------- POST
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return bad('That request could not be read. Please try again.'); }
  try {
    const who = await loadActor(body.actorId || body.createdBy);
    if (who.error) return bad(who.error, who.status);
    const { user } = who;

    if (body.action === 'remind') return remind(body, user);

    if (!canSchedule(user)) return bad('Only ministry heads, pastors and admins can schedule meetings.', 403);
    const text = checkText(body);
    if (text.error) return bad(text.error);
    if (!text.title) return bad('Please give the meeting a title.');
    const ministries = await readMinistries(body.ministries ?? body.ministry);
    if (!ministries.length) return bad('Please choose at least one ministry to invite.');
    const time = readTime(body);
    if (time.error) return bad(time.error);
    if (!time.iso) return bad('Please pick the date and time of the meeting.');
    const late = checkTime(time.iso, { mustBeAhead: true });
    if (late) return bad(late);

    const name = fullName(user);
    const { data: row, error } = await supabaseAdmin.from('ministry_meetings').insert({
      title: text.title,
      description: text.description || null,
      ministry: ministries.join(', '),
      meeting_date: time.iso,
      location: text.location || null,
      created_by: user.id,
      created_by_name: name,
      status: 'Scheduled',
    }).select().single();
    if (error) throw error;

    // The person who set it is going.
    await supabaseAdmin.from('meeting_rsvps')
      .upsert({ meeting_id: row.id, user_id: user.id, status: 'Going' }, { onConflict: 'meeting_id,user_id' });

    const people = await loadPeople();
    const invited = invitedTo(row, people).map((u) => u.id).filter((id) => id !== user.id);
    const where = text.location ? ` at ${text.location}` : '';
    const told = await notify(invited, {
      title: `New meeting: ${text.title}`,
      message: `${whenLabel(time.iso)}${where}. ${first(name)} would love to know if you can come - open Ministry Meetings to answer.`,
    });

    const meeting = await shapeOne(row, user);
    return ok({
      data: meeting,
      message: told
        ? `Meeting scheduled! We let ${plural(told, 'member')} know.`
        : 'Meeting scheduled!',
    });
  } catch (error) {
    return oops('POST', error);
  }
}

// Nudge everyone invited who has not answered. Once every 6 hours at most.
async function remind(body, user) {
  const { data: row } = await supabaseAdmin.from('ministry_meetings').select('*').eq('id', String(body.id || '')).maybeSingle();
  if (!row) return bad('This meeting no longer exists.', 404);
  if (!canRun(user, row)) return bad('Only the person who set this meeting, a pastor or an admin can send reminders.', 403);
  if (row.status !== 'Scheduled') return bad('This meeting is not on, so there is nothing to remind people about.');
  if (new Date(row.meeting_date).getTime() < Date.now()) return bad('This meeting has already started.');

  const meeting = await shapeOne(row, user);
  const ids = meeting.noReply.map((p) => p.id).filter((id) => id !== user.id);
  if (!ids.length) return ok({ data: meeting, message: 'Everyone has already answered. Nothing to send!' });

  const title = `Reminder: ${row.title}`;
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin.from('notifications').select('id', { count: 'exact', head: true })
    .in('user_id', ids).eq('title', title).gte('created_at', since);
  if (count) return bad('A reminder already went out in the last few hours. Please give people a little time to answer.', 429);

  const where = row.location ? ` at ${row.location}` : '';
  const sent = await notify(ids, {
    title,
    message: `${whenLabel(row.meeting_date)}${where}. Please let ${first(fullName(user))} know if you can come.`,
  });
  return ok({ data: meeting, message: sent ? `Reminder sent to ${plural(sent, 'person', 'people')}.` : 'The reminder could not be sent. Please try again.' });
}

// ---------------------------------------------------------------- PUT
export async function PUT(request) {
  let body;
  try { body = await request.json(); } catch { return bad('That request could not be read. Please try again.'); }
  try {
    const who = await loadActor(body.actorId || body.createdBy);
    if (who.error) return bad(who.error, who.status);
    const { user } = who;
    if (!body.id) return bad('Which meeting? Please open it again and retry.');

    const { data: found, error: findError } = await supabaseAdmin.from('ministry_meetings').select('*').eq('id', String(body.id)).maybeSingle();
    if (findError) throw findError;
    if (!found) return bad('This meeting no longer exists.', 404);
    if (!canRun(user, found)) return bad('Only the person who set this meeting, a pastor or an admin can change it.', 403);
    const row = { ...found }; // as it was, to tell what changed

    const text = checkText(body);
    if (text.error) return bad(text.error);
    const changes = {};
    if (body.title !== undefined) changes.title = text.title;
    if (body.description !== undefined) changes.description = text.description || null;
    if (body.location !== undefined) changes.location = text.location || null;
    if (body.ministries !== undefined || body.ministry !== undefined) {
      const ministries = await readMinistries(body.ministries ?? body.ministry);
      if (!ministries.length) return bad('Please choose at least one ministry to invite.');
      changes.ministry = ministries.join(', ');
    }
    const time = readTime(body);
    if (time.error) return bad(time.error);
    const moved = time.iso && new Date(time.iso).getTime() !== new Date(row.meeting_date).getTime();
    if (moved) changes.meeting_date = time.iso;
    if (body.status !== undefined) {
      if (!MEETING_STATUSES.includes(body.status)) return bad('That status is not one we know.');
      changes.status = body.status;
    }
    const nextStatus = changes.status || row.status;
    if (moved && nextStatus === 'Scheduled') {
      const late = checkTime(time.iso, { mustBeAhead: true });
      if (late) return bad(late);
    }
    const reopened = row.status === 'Cancelled' && nextStatus === 'Scheduled';
    if (reopened && !moved && new Date(row.meeting_date).getTime() < Date.now()) {
      return bad('This meeting\'s time has passed. Please pick a new time to put it back on.');
    }
    changes.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabaseAdmin.from('ministry_meetings').update(changes).eq('id', row.id).select().single();
    if (error) throw error;

    // Tell the people it matters to.
    const people = await loadPeople();
    const rsvps = (await loadRsvps([row.id])).get(row.id) || [];
    const coming = rsvps.filter((r) => r.status === 'Going' || r.status === 'Maybe').map((r) => r.user_id).filter((id) => id !== user.id);
    const placeMoved = changes.location !== undefined && (changes.location || '') !== (row.location || '');
    const where = updated.location ? ` at ${updated.location}` : '';
    let told = 0;
    if (nextStatus === 'Scheduled' && (moved || placeMoved) && !reopened) {
      told += await notify(coming, {
        title: `${moved ? 'New time' : 'New place'}: ${updated.title}`,
        message: `The meeting is now ${whenLabel(updated.meeting_date)}${where}. Please update your calendar.`,
        type: 'warning',
      });
    }
    if (reopened) {
      const all = invitedTo(updated, people).map((u) => u.id).filter((id) => id !== user.id);
      told += await notify(all, {
        title: `Back on: ${updated.title}`,
        message: `${whenLabel(updated.meeting_date)}${where}. Open Ministry Meetings to answer.`,
      });
    } else if (nextStatus === 'Scheduled' && changes.ministry) {
      const before = new Set(invitedTo(row, people).map((u) => u.id));
      const added = invitedTo(updated, people).map((u) => u.id).filter((id) => !before.has(id) && id !== user.id);
      told += await notify(added, {
        title: `New meeting: ${updated.title}`,
        message: `${whenLabel(updated.meeting_date)}${where}. Open Ministry Meetings to answer.`,
      });
    }

    const meeting = shapeMeeting(updated, { viewer: user, people, rsvps });
    let message = 'Meeting updated.';
    if (changes.status === 'Completed' && row.status !== 'Completed') message = 'Marked as done. Thank you for leading it!';
    else if (reopened) message = told ? `The meeting is back on. We let ${plural(told, 'member')} know.` : 'The meeting is back on.';
    else if (told) message = `Meeting updated. We let ${plural(told, 'person', 'people')} know about the change.`;
    return ok({ data: meeting, message });
  } catch (error) {
    return oops('PUT', error);
  }
}

// ---------------------------------------------------------------- DELETE
export async function DELETE(request) {
  try {
    const sp = new URL(request.url).searchParams;
    const who = await loadActor(sp.get('actorId'));
    if (who.error) return bad(who.error, who.status);
    const { user } = who;
    const id = sp.get('id');
    if (!id) return bad('Which meeting? Please open it again and retry.');

    const { data: row, error: findError } = await supabaseAdmin.from('ministry_meetings').select('*').eq('id', String(id)).maybeSingle();
    if (findError) throw findError;
    if (!row) return bad('This meeting was already removed.', 404);
    if (!canRun(user, row)) return bad('Only the person who set this meeting, a pastor or an admin can cancel it.', 403);

    const rsvps = (await loadRsvps([row.id])).get(row.id) || [];
    const coming = rsvps.filter((r) => r.status === 'Going' || r.status === 'Maybe').map((r) => r.user_id).filter((rid) => rid !== user.id);
    const upcoming = new Date(row.meeting_date).getTime() > Date.now();

    if (sp.get('mode') === 'hard') {
      const roles = getUserRoles(user);
      if (row.created_by !== user.id && !roles.some((r) => r === 'Admin' || r === 'Super Admin')) {
        return bad('Only the person who set this meeting or an admin can remove it for good.', 403);
      }
      await supabaseAdmin.from('meeting_rsvps').delete().eq('meeting_id', row.id);
      const { error } = await supabaseAdmin.from('ministry_meetings').delete().eq('id', row.id);
      if (error) throw error;
      if (upcoming && row.status === 'Scheduled') {
        await notify(coming, {
          title: `Cancelled: ${row.title}`,
          message: `The meeting on ${whenLabel(row.meeting_date)} will not go ahead.`,
          type: 'warning',
        });
      }
      return ok({ removed: row.id, message: 'Meeting removed.' });
    }

    if (row.status === 'Cancelled') return ok({ message: 'This meeting was already cancelled.' });
    const { data: updated, error } = await supabaseAdmin.from('ministry_meetings')
      .update({ status: 'Cancelled', updated_at: new Date().toISOString() }).eq('id', row.id).select().single();
    if (error) throw error;
    const told = upcoming ? await notify(coming, {
      title: `Cancelled: ${row.title}`,
      message: `The meeting on ${whenLabel(row.meeting_date)} will not go ahead. Please take it off your calendar.`,
      type: 'warning',
    }) : 0;
    const people = await loadPeople();
    const meeting = shapeMeeting(updated, { viewer: user, people, rsvps });
    return ok({
      data: meeting,
      message: told ? `Meeting cancelled. We let ${plural(told, 'person', 'people')} who were coming know.` : 'Meeting cancelled.',
    });
  } catch (error) {
    return oops('DELETE', error);
  }
}

