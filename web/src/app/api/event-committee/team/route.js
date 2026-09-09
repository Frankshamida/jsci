import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// Who is on the committee, and the Admin controls for changing that.
//
// This lives in the committee portal rather than the main admin dashboard for a
// practical reason: without it there is no way to put the FIRST person on the
// committee, so the portal would ship locked to everyone. An Admin signing in
// here sees a Team tab; a committee member does not.

const LIST_COLUMNS = 'id, member_id, firstname, lastname, email, role, ministry, sub_role, is_active, profile_picture, is_event_committee, committee_events, committee_requested_at, committee_assigned_at';

// The committee columns arrive in supabase/migrations/event_committee.sql. Until
// it is run, this route's answer is "run the migration" rather than a 500 with a
// Postgres error in it.
function migrationMissing(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('is_event_committee') || text.includes('committee_events') || text.includes('committee_requested_at');
}

const NEEDS_MIGRATION = () => NextResponse.json({
  success: false,
  code: 'NEEDS_MIGRATION',
  message: 'The committee columns are not in the database yet. Run supabase/migrations/event_committee.sql in the Supabase SQL editor.',
}, { status: 503 });

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action,
      resource: 'event_committee',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// GET ?actorId=..            -> current members + everyone waiting to be added,
//                               plus a browsable page of every other account
//     &q=name or email       -> narrows that page to a search
//     &role=Member           -> only accounts with that role
//     &page=1&limit=25       -> which slice of it
//     &pool=1                -> ONLY that slice: searching the account picker
//                               must not re-read the member list underneath it
//
// The account list is returned whether or not a search was typed. An Admin
// adding the first few people does not know who signed up under what spelling,
// so "search and you shall find" left the tab looking as though the church had
// one member in it. Browsing is the default; the search narrows.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    // Typing in the picker asks for the pool and nothing else. The member list
    // has not changed because somebody pressed a key, so re-reading it would
    // only make the table on the page flicker.
    const poolOnly = searchParams.get('pool') === '1';

    let members = null;
    let waiting = null;
    if (!poolOnly) {
      const { data: memberRows, error } = await supabase
        .from('users').select(LIST_COLUMNS)
        .eq('is_event_committee', true)
        .order('firstname', { ascending: true });
      if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });
      members = memberRows || [];

      const { data: waitingRows } = await supabase
        .from('users').select(LIST_COLUMNS)
        .not('committee_requested_at', 'is', null)
        .eq('is_event_committee', false)
        .order('committee_requested_at', { ascending: true })
        .limit(100);
      waiting = waitingRows || [];
    }

    // Everybody who is NOT already on the committee - the pool to add from.
    const q = (searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit'), 10) || 25, 1), 100);
    const page = Math.max(parseInt(searchParams.get('page'), 10) || 1, 1);
    const from = (page - 1) * limit;

    const role = (searchParams.get('role') || '').trim();

    let pool = supabase
      .from('users').select(LIST_COLUMNS, { count: 'exact' })
      .eq('is_event_committee', false)
      .order('firstname', { ascending: true })
      .range(from, from + limit - 1);
    // One character is not a search, it is most of the church - so it is
    // treated as no search at all rather than as a filter.
    if (q.length >= 2) {
      const like = `%${q}%`;
      pool = pool.or(`firstname.ilike.${like},lastname.ilike.${like},email.ilike.${like}`);
    }
    // Filtered here rather than in the browser: the list arrives one page at a
    // time, so filtering what has already been fetched would only ever filter
    // those 25 rows.
    if (role && role !== 'all') pool = pool.eq('role', role);
    const { data: found, count: matchesTotal } = await pool;

    // The roles actually present in the pool, so the dropdown never offers a
    // role that would come back empty. Read off the whole pool, not the page.
    const { data: roleRows } = await supabase
      .from('users').select('role').eq('is_event_committee', false).limit(2000);
    const roles = [...new Set((roleRows || []).map((r) => r.role).filter(Boolean))].sort();

    return NextResponse.json({
      success: true,
      data: {
        // Omitted entirely on a pool-only read, so the client keeps the lists
        // it already has rather than being handed empty ones.
        ...(poolOnly ? {} : { members, waiting }),
        matches: found || [],
        matchesTotal: matchesTotal || 0,
        matchesPage: page,
        roles,
        matchesLimit: limit,
        searching: q.length >= 2,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT { actorId, userId, isCommittee?, committeeEvents? }
//   -> add or remove a member, and/or narrow them to particular events
export async function PUT(request) {
  try {
    const { actorId, userId, isCommittee, committeeEvents } = await request.json();
    const actor = await requireManager(actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!userId) return NextResponse.json({ success: false, message: 'userId required' }, { status: 400 });

    const { data: target } = await supabase
      .from('users').select('id, firstname, lastname, role, is_event_committee').eq('id', userId).single();
    if (!target) return NextResponse.json({ success: false, message: 'Account not found' }, { status: 404 });

    const update = {};
    if (isCommittee !== undefined) {
      update.is_event_committee = !!isCommittee;
      if (isCommittee) {
        update.committee_assigned_at = new Date().toISOString();
        update.committee_assigned_by = actor.id;
        // Off the waiting list - they have been dealt with.
        update.committee_requested_at = null;
      } else {
        // Removing someone drops their scoping AND the roles they held, so
        // re-adding them later starts from "every event, no role" rather than
        // from a stale roster. Best-effort: the table may not exist yet.
        try { await supabase.from('committee_assignments').delete().eq('user_id', userId); } catch { /* not migrated */ }
        update.committee_events = [];
        update.committee_assigned_at = null;
        update.committee_assigned_by = null;
      }
    }
    if (committeeEvents !== undefined) {
      update.committee_events = Array.isArray(committeeEvents) ? committeeEvents.filter(Boolean).map(String) : [];
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, message: 'Nothing to change' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('users').update(update).eq('id', userId).select(LIST_COLUMNS).single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    const name = `${target.firstname} ${target.lastname}`.trim();
    if (isCommittee !== undefined) {
      await logAudit(actor, isCommittee ? 'event_committee_add' : 'event_committee_remove', userId,
        isCommittee ? `Added ${name} to the Event Committee` : `Removed ${name} from the Event Committee`);
      // Told in the main dashboard, because that is where they already are.
      try {
        await supabase.from('notifications').insert({
          user_id: userId,
          title: isCommittee ? '🎟️ You are on the Event Committee' : 'Event Committee access removed',
          message: isCommittee
            ? 'You can now sign in at the Event Committee portal with this same account and password.'
            : 'Your Event Committee access has been removed. Your main account is unchanged.',
          type: 'info',
          link: 'my-profile',
        });
      } catch { /* notification is a courtesy, not the change itself */ }
    } else {
      const scope = (data.committee_events || []).length;
      await logAudit(actor, 'event_committee_scope', userId,
        scope === 0 ? `${name} now covers all events` : `${name} now covers ${scope} event${scope === 1 ? '' : 's'}`);
    }

    return NextResponse.json({
      success: true,
      data,
      message: isCommittee === true ? `${name} added to the committee`
        : isCommittee === false ? `${name} removed from the committee`
        : 'Assignments updated',
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
