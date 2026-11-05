import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf } from '@/lib/ministryAuth';
import { ROLE_TYPE_OF_PART, churchDate, addDays } from '@/lib/ministryApp';
import { lineupParts } from '@/lib/userRoles';
import { pictureMap } from '@/lib/ministrySchedule';
import { SWAP_OPEN, isSwappablePart, namesInPart, shapeSwap, swapProblem } from '@/lib/ministrySwaps';

// Swaps: you give away your part on one of your dates and take a teammate's
// same part on one of theirs. They accept, then the Schedule Plotter approves
// (/api/ministry/approvals), which changes both lineups.

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const lc = (s) => String(s || '').trim().toLowerCase();
const longDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
// The table comes with the 1.3 database update.
const NOT_READY = 'Swaps are not set up yet. Ask an admin to run the JSCI Ministry 1.3 database update.';
const missingTable = (error) => error && /lineup_swaps|relation|does not exist|schema cache/i.test(error.message || '');

const partsOn = (s, name) => lineupParts({ songLeader: s.song_leader, backupSingers: s.backup_singers, musicians: s.musicians, dancers: s.dancers })[lc(name)]?.parts || [];

async function notify(userId, title, message) {
  try {
    await supabase.from('notifications').insert({ user_id: userId, title, message, type: 'lineup', link: '/dashboard?section=praise-worship' });
  } catch { /* a missed notice never fails the swap */ }
}

// GET - Who you could swap with: ?scheduleId= of one of your upcoming lineups.
// Teammates with the same part on another date in the next four months, where
// neither of you is already on the other's date.
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;
  const scheduleId = new URL(request.url).searchParams.get('scheduleId');
  const today = churchDate();

  const { data: mine } = await supabase.from('schedules').select('*').eq('schedule_id', scheduleId).maybeSingle();
  if (!mine) return bad('Lineup not found.', 404);
  if (mine.schedule_date < today) return bad('That date has passed.');
  const me = fullNameOf(user);
  const parts = partsOn(mine, me).filter(isSwappablePart);
  if (!parts.length) return bad('You are not on this lineup.');

  const [{ data: upcoming }, pictures, { data: people }] = await Promise.all([
    supabase.from('schedules').select('*').gte('schedule_date', today).lte('schedule_date', addDays(today, 120)).neq('schedule_id', scheduleId).order('schedule_date', { ascending: true }),
    pictureMap(),
    supabase.from('users').select('id, firstname, lastname').eq('is_active', true),
  ]);
  const idByName = Object.fromEntries((people || []).map((p) => [lc(`${p.firstname} ${p.lastname}`), p.id]));

  const candidates = [];
  for (const part of parts) {
    for (const s of upcoming || []) {
      for (const name of namesInPart(s, part)) {
        const partnerId = idByName[lc(name)];
        if (!partnerId || partnerId === user.id) continue;
        const swap = { part, requester_name: me, requester_date: mine.schedule_date, partner_name: name, partner_date: s.schedule_date };
        if (swapProblem(swap, mine, s, today)) continue;
        candidates.push({ part, date: s.schedule_date, scheduleId: s.schedule_id, partnerId, partnerName: name, partnerPicture: pictures[lc(name)] || null });
      }
    }
  }
  return NextResponse.json({ success: true, data: { date: mine.schedule_date, parts, candidates } });
}

// POST - Ask a teammate to swap: { scheduleId, part, partnerId, partnerDate, reason }.
export async function POST(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;
  const { scheduleId, part, partnerId, partnerDate, reason } = await request.json();
  const today = churchDate();
  if (!isSwappablePart(part)) return bad('Pick the part to swap.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(partnerDate || ''))) return bad('Pick the date to swap with.');

  const [{ data: mine }, { data: theirs }, { data: partner }] = await Promise.all([
    supabase.from('schedules').select('*').eq('schedule_id', scheduleId).maybeSingle(),
    supabase.from('schedules').select('*').eq('schedule_date', partnerDate).maybeSingle(),
    supabase.from('users').select('id, firstname, lastname').eq('id', partnerId).maybeSingle(),
  ]);
  if (!mine || !theirs || !partner) return bad('That lineup or teammate was not found.', 404);

  const me = fullNameOf(user);
  const partnerName = namesInPart(theirs, part).find((n) => lc(n) === lc(fullNameOf(partner)));
  if (!partnerName) return bad(`${fullNameOf(partner)} is not ${part} on that date.`);
  const row = {
    requester_id: user.id,
    requester_name: me,
    requester_date: mine.schedule_date,
    partner_id: partner.id,
    partner_name: partnerName,
    partner_date: theirs.schedule_date,
    part,
    role_type: ROLE_TYPE_OF_PART[part],
    reason: String(reason || '').trim().slice(0, 500) || null,
    status: 'Waiting Partner',
  };
  const problem = swapProblem(row, mine, theirs, today);
  if (problem) return bad(problem);

  const open = await supabaseAdmin.from('lineup_swaps').select('id').eq('requester_id', user.id).eq('requester_date', row.requester_date).in('status', SWAP_OPEN).limit(1);
  if (missingTable(open.error)) return bad(NOT_READY, 503);
  if (open.data?.length) return bad('You already asked to swap this date. Cancel that request first.', 409);

  const { data, error } = await supabaseAdmin.from('lineup_swaps').insert(row).select().single();
  if (error) {
    console.error('POST /api/ministry/swaps error:', error);
    return bad(missingTable(error) ? NOT_READY : 'Could not send the swap request. Try again.', missingTable(error) ? 503 : 500);
  }
  await notify(partner.id, `🔁 Swap request from ${me}`,
    `${me} asks to swap ${part}: you take ${longDate(row.requester_date)} and ${me} takes your ${longDate(row.partner_date)}.${row.reason ? ` Reason: "${row.reason}"` : ''} Answer in the JSCI Ministry app.`);
  return NextResponse.json({ success: true, message: `Swap request sent to ${partnerName}.`, data: shapeSwap(data) });
}

// PUT - The partner answers: { id, action: 'accept' | 'decline', note }.
// Accepted swaps wait for the Schedule Plotter.
export async function PUT(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;
  const { id, action, note } = await request.json();

  const { data: swap, error } = await supabaseAdmin.from('lineup_swaps').select('*').eq('id', id).maybeSingle();
  if (missingTable(error)) return bad(NOT_READY, 503);
  if (!swap || swap.partner_id !== user.id) return bad('Swap request not found.', 404);
  if (swap.status !== 'Waiting Partner') return bad('This swap request was already answered.', 409);

  const partnerNote = String(note || '').trim().slice(0, 300) || null;
  if (action === 'accept') {
    const { data: rows } = await supabase.from('schedules').select('*').in('schedule_date', [swap.requester_date, swap.partner_date]);
    const mine = (rows || []).find((r) => r.schedule_date === swap.requester_date) || null;
    const theirs = (rows || []).find((r) => r.schedule_date === swap.partner_date) || null;
    const problem = swapProblem(swap, mine, theirs, churchDate());
    if (problem) return bad(problem, 409);
    await supabaseAdmin.from('lineup_swaps').update({ status: 'Pending Approval', partner_note: partnerNote, responded_at: new Date().toISOString() }).eq('id', id);
    await notify(swap.requester_id, `🔁 ${swap.partner_name} accepted your swap`,
      `${swap.partner_name} agreed to swap ${swap.part} (${longDate(swap.requester_date)} ⇄ ${longDate(swap.partner_date)}). It now waits for the Schedule Plotter's approval.`);
    return NextResponse.json({ success: true, message: 'You accepted. The Schedule Plotter will approve it.' });
  }
  if (action === 'decline') {
    await supabaseAdmin.from('lineup_swaps').update({ status: 'Declined', partner_note: partnerNote, responded_at: new Date().toISOString() }).eq('id', id);
    await notify(swap.requester_id, `🔁 ${swap.partner_name} can't swap`,
      `${swap.partner_name} declined to swap ${swap.part} (${longDate(swap.requester_date)} ⇄ ${longDate(swap.partner_date)}).${partnerNote ? ` Note: "${partnerNote}"` : ''}`);
    return NextResponse.json({ success: true, message: 'Swap request declined.' });
  }
  return bad('Unknown action.');
}

// DELETE - Take back your own swap request before it is approved: ?id=
export async function DELETE(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  const { data: swap, error } = await supabaseAdmin.from('lineup_swaps').select('*').eq('id', id).maybeSingle();
  if (missingTable(error)) return bad(NOT_READY, 503);
  if (!swap || swap.requester_id !== auth.user.id) return bad('Swap request not found.', 404);
  if (!SWAP_OPEN.includes(swap.status)) return bad('This swap can no longer be cancelled.');
  await supabaseAdmin.from('lineup_swaps').update({ status: 'Cancelled' }).eq('id', id);
  if (swap.status === 'Pending Approval' || swap.status === 'Waiting Partner') {
    await notify(swap.partner_id, `🔁 Swap cancelled`, `${swap.requester_name} took back the swap request for ${longDate(swap.partner_date)}.`);
  }
  return NextResponse.json({ success: true, message: 'Swap request cancelled.' });
}
