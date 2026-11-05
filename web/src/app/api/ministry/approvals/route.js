import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf, internalJson } from '@/lib/ministryAuth';
import { canPlot, churchDate, addDays } from '@/lib/ministryApp';
import { lineupParts } from '@/lib/userRoles';
import { applySwap, shapeSwap, swapProblem } from '@/lib/ministrySwaps';
import { PUT as updateSub } from '@/app/api/lineup/substitutes/route';

// ============================================================
// JSCI Ministry app - what the Schedule Plotter approves
//   GET  excuses, substitute requests and swaps waiting for a decision,
//        and the ones decided lately
//   PUT  { kind: 'excuse' | 'sub' | 'swap', id, decision: 'approve' | 'reject', note? }
// Substitute requests go through the website's own route, so approving one
// in the app notifies the team exactly as the website does.
// ============================================================

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const first = (name) => String(name || '').split(' ')[0];

async function plotter(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth;
  // 400, not 403: the app reads a 403 as "your session ended" and signs out.
  if (!canPlot(auth.user)) return { response: bad('Only the Schedule Plotter can do this.', 400) };
  return auth;
}

// lineup_swaps exists once the 1.3 migration has run; before that there are simply no swaps.
const rowsOr = (res, fallback = []) => (res.error ? fallback : res.data || fallback);

// The parts somebody has on a lineup ([] when they are not on it).
const partsOn = (schedule, name) => (schedule
  ? lineupParts({ songLeader: schedule.song_leader, backupSingers: schedule.backup_singers, musicians: schedule.musicians, dancers: schedule.dancers })[String(name || '').trim().toLowerCase()]?.parts || []
  : []);

async function notify(rows) {
  try {
    const { error } = await supabase.from('notifications').insert(rows);
    if (error) console.error('ministry approvals notify:', error.message);
  } catch (e) {
    console.error('ministry approvals notify:', e);
  }
}

// ---- GET ----
export async function GET(request) {
  const auth = await plotter(request);
  if (auth.response) return auth.response;

  try {
    const today = churchDate();
    const [excuses, subs, swaps, doneExcuses, doneSubs, doneSwaps] = await Promise.all([
      supabase.from('lineup_excuses').select('*').eq('status', 'Pending').gte('excuse_date', addDays(today, -7)).order('excuse_date', { ascending: true }),
      supabase.from('lineup_substitutes').select('*').eq('status', 'Pending Admin').order('schedule_date', { ascending: true }),
      supabaseAdmin.from('lineup_swaps').select('*').eq('status', 'Pending Approval').order('requester_date', { ascending: true }),
      supabase.from('lineup_excuses').select('id, user_id, user_name, excuse_date, status, role_type, reviewed_by, updated_at')
        .in('status', ['Approved', 'Rejected']).order('updated_at', { ascending: false }).limit(30),
      supabase.from('lineup_substitutes').select('id, requester_id, requester_name, schedule_date, status, role_type, reviewed_by, updated_at, substitute_name')
        .in('status', ['Open for Sub', 'Accepted', 'Rejected']).order('updated_at', { ascending: false }).limit(30),
      supabaseAdmin.from('lineup_swaps').select('*').in('status', ['Approved', 'Rejected']).order('reviewed_at', { ascending: false, nullsFirst: false }).limit(30),
    ]);
    if (excuses.error) throw excuses.error;
    if (subs.error) throw subs.error;
    const pendingSwaps = rowsOr(swaps);

    // The lineups on those dates, to say who is actually on them.
    const dates = [...new Set([
      ...(excuses.data || []).map((e) => e.excuse_date),
      ...(subs.data || []).map((x) => x.schedule_date),
      ...pendingSwaps.flatMap((w) => [w.requester_date, w.partner_date]),
    ])];
    const ids = [...new Set([
      ...(excuses.data || []).map((e) => e.user_id),
      ...(subs.data || []).map((x) => x.requester_id),
      ...pendingSwaps.flatMap((w) => [w.requester_id, w.partner_id]),
    ].filter(Boolean))];
    const [schedules, users] = await Promise.all([
      dates.length ? supabase.from('schedules').select('*').in('schedule_date', dates) : Promise.resolve({ data: [] }),
      ids.length ? supabase.from('users').select('id, profile_picture').in('id', ids) : Promise.resolve({ data: [] }),
    ]);
    const byDate = Object.fromEntries((schedules.data || []).map((s) => [s.schedule_date, s]));
    const picture = Object.fromEntries((users.data || []).map((u) => [u.id, u.profile_picture || null]));

    const data = {
      today,
      excuses: (excuses.data || []).map((e) => {
        const parts = partsOn(byDate[e.excuse_date], e.user_name);
        return {
          id: e.id,
          userId: e.user_id,
          name: e.user_name,
          picture: picture[e.user_id] || e.profile_picture || null,
          date: e.excuse_date,
          roleType: e.role_type || 'Song Leader',
          reason: e.reason || '',
          createdAt: e.created_at,
          hasLineup: !!byDate[e.excuse_date],
          parts,
        };
      }),
      subs: (subs.data || []).map((x) => {
        const parts = partsOn(byDate[x.schedule_date], x.requester_name);
        return {
          id: x.id,
          userId: x.requester_id,
          name: x.requester_name,
          picture: picture[x.requester_id] || x.requester_profile_picture || null,
          date: x.schedule_date,
          roleType: x.role_type || 'Song Leader',
          reason: x.reason || '',
          createdAt: x.created_at,
          hasLineup: !!byDate[x.schedule_date],
          parts,
        };
      }),
      swaps: pendingSwaps.map((w) => ({
        ...shapeSwap(w),
        requesterPicture: picture[w.requester_id] || null,
        partnerPicture: picture[w.partner_id] || null,
        // Lineups change after a swap is asked: say now if it can no longer happen.
        problem: swapProblem(w, byDate[w.requester_date] || null, byDate[w.partner_date] || null, today),
      })),
      recent: [
        ...rowsOr(doneExcuses).map((e) => ({
          kind: 'excuse', id: e.id, name: e.user_name, date: e.excuse_date, otherDate: null, partner: null,
          part: e.role_type || 'Song Leader', status: e.status, reviewedBy: e.reviewed_by || null, decidedAt: e.updated_at,
        })),
        ...rowsOr(doneSubs).map((x) => ({
          kind: 'sub', id: x.id, name: x.requester_name, date: x.schedule_date, otherDate: null, partner: x.substitute_name || null,
          part: x.role_type || 'Song Leader', status: x.status === 'Rejected' ? 'Rejected' : 'Approved',
          reviewedBy: x.reviewed_by || null, decidedAt: x.updated_at,
        })),
        ...rowsOr(doneSwaps).map((w) => ({
          kind: 'swap', id: w.id, name: w.requester_name, date: w.requester_date, otherDate: w.partner_date, partner: w.partner_name,
          part: w.part, status: w.status, reviewedBy: w.reviewed_by || null, decidedAt: w.reviewed_at || w.updated_at,
        })),
      ].sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt))).slice(0, 30),
    };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/ministry/approvals error:', error);
    return bad('Could not load the approvals. Pull down to try again.', 500);
  }
}

// ---- PUT ----
export async function PUT(request) {
  const auth = await plotter(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const { kind, id, decision, note } = await request.json();
    if (!id) return bad('Nothing picked.');
    if (decision !== 'approve' && decision !== 'reject') return bad('Approve or reject?');
    const approve = decision === 'approve';
    const reviewer = fullNameOf(user);
    const adminNote = String(note || '').trim().slice(0, 300) || null;
    const noteLine = adminNote ? ` Note: ${adminNote}` : '';

    // ---- Excuse ----
    if (kind === 'excuse') {
      const { data: excuse } = await supabase.from('lineup_excuses').select('*').eq('id', id).maybeSingle();
      if (!excuse) return bad('Excuse not found. It may have been taken back.', 404);
      if (excuse.status !== 'Pending') return bad(`This excuse was already ${String(excuse.status).toLowerCase()}.`, 409);
      // Only while still pending, so two plotters never both decide it.
      const { data: changed, error } = await supabase.from('lineup_excuses')
        .update({ status: approve ? 'Approved' : 'Rejected', reviewed_by: reviewer, admin_note: adminNote })
        .eq('id', id).eq('status', 'Pending').select('id');
      if (error) throw error;
      if (!changed?.length) return bad('Somebody else just decided this excuse.', 409);
      const when = longDate(excuse.excuse_date);
      await notify([{
        user_id: excuse.user_id,
        title: approve ? `✅ Excuse Approved (${excuse.role_type || 'Song Leader'})` : `❌ Excuse Not Approved (${excuse.role_type || 'Song Leader'})`,
        message: approve
          ? `Your excuse for ${when} was approved by ${reviewer}.${noteLine}`
          : `Your excuse for ${when} was not approved by ${reviewer}. Please talk to the Schedule Plotter.${noteLine}`,
        type: 'lineup',
        link: '/dashboard?section=praise-worship',
      }]);
      return NextResponse.json({ success: true, message: approve ? `${first(excuse.user_name)} is excused on ${when}.` : 'Excuse rejected.' });
    }

    // ---- Substitute request ----
    if (kind === 'sub') {
      const { data: sub } = await supabase.from('lineup_substitutes').select('id, status').eq('id', id).maybeSingle();
      if (!sub) return bad('Request not found. It may have been cancelled.', 404);
      if (sub.status !== 'Pending Admin') return bad('This request was already decided.', 409);
      return updateSub(internalJson('/api/lineup/substitutes', 'PUT', {
        id, action: approve ? 'admin-approve' : 'admin-reject', reviewedBy: reviewer, adminNote,
      }));
    }

    // ---- Swap ----
    if (kind === 'swap') {
      const found = await supabaseAdmin.from('lineup_swaps').select('*').eq('id', id).maybeSingle();
      if (found.error) return bad('Swaps are not set up yet. Run the ministry_app_v1_3 migration in Supabase.', 400);
      const swap = found.data;
      if (!swap) return bad('Swap not found. It may have been cancelled.', 404);
      if (swap.status !== 'Pending Approval') return bad(swap.status === 'Waiting Partner' ? `${first(swap.partner_name)} has not answered yet.` : 'This swap was already decided.', 409);

      const now = new Date().toISOString();
      const mine = longDate(swap.requester_date);
      const theirs = longDate(swap.partner_date);

      if (!approve) {
        const { data: changed, error } = await supabaseAdmin.from('lineup_swaps')
          .update({ status: 'Rejected', reviewed_by: reviewer, reviewed_at: now, admin_note: adminNote })
          .eq('id', id).eq('status', 'Pending Approval').select('id');
        if (error) throw error;
        if (!changed?.length) return bad('Somebody else just decided this swap.', 409);
        const message = `The swap between ${swap.requester_name} (${mine}) and ${swap.partner_name} (${theirs}) as ${swap.part} was not approved by ${reviewer}. You both stay on your own dates.${noteLine}`;
        await notify([swap.requester_id, swap.partner_id].map((uid) => ({ user_id: uid, title: '❌ Swap Not Approved', message, type: 'lineup', link: '/dashboard?section=praise-worship' })));
        return NextResponse.json({ success: true, message: 'Swap rejected. Both stay on their own dates.' });
      }

      // Claim it first, so two plotters never apply it twice; put it back if the lineups say no.
      const { data: claimed, error: claimError } = await supabaseAdmin.from('lineup_swaps')
        .update({ status: 'Approved', reviewed_by: reviewer, reviewed_at: now, admin_note: adminNote })
        .eq('id', id).eq('status', 'Pending Approval').select('id');
      if (claimError) throw claimError;
      if (!claimed?.length) return bad('Somebody else just decided this swap.', 409);

      const problem = await applySwap(swap);
      if (problem) {
        await supabaseAdmin.from('lineup_swaps').update({ status: 'Pending Approval', reviewed_by: null, reviewed_at: null, admin_note: null }).eq('id', id);
        return bad(`${problem} The swap was not made.`, 409);
      }

      await notify([
        {
          user_id: swap.requester_id,
          title: '🔁 Swap Approved!',
          message: `Your swap with ${swap.partner_name} was approved by ${reviewer}: you are now ${swap.part} on ${theirs}, and ${first(swap.partner_name)} takes ${mine}.${noteLine}`,
          type: 'lineup',
          link: '/dashboard?section=praise-worship',
        },
        {
          user_id: swap.partner_id,
          title: '🔁 Swap Approved!',
          message: `Your swap with ${swap.requester_name} was approved by ${reviewer}: you are now ${swap.part} on ${mine}, and ${first(swap.requester_name)} takes ${theirs}.${noteLine}`,
          type: 'lineup',
          link: '/dashboard?section=praise-worship',
        },
      ]);
      return NextResponse.json({ success: true, message: `Swapped. ${first(swap.partner_name)} serves ${mine}, ${first(swap.requester_name)} serves ${theirs}.` });
    }

    return bad('Unknown request.');
  } catch (error) {
    console.error('PUT /api/ministry/approvals error:', error);
    return bad('Could not save the decision. Try again.', 500);
  }
}
