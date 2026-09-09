import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';

// What a committee member DOES on an event, as opposed to which events they
// may open. The scope lives on users.committee_events; the roles live here,
// one row per member per event.
//
// Setting an Admin's own roles is allowed and meaningless - they can work every
// event regardless - so nothing special is done about it.

const COLUMNS = 'id, user_id, event_id, roles, assigned_by, created_at, updated_at';

// The roles the committee starts with. An Admin may type any other.
export const DEFAULT_COMMITTEE_ROLES = [
  'Registration',
  'Cashier',
  'Usher',
  'Attendance / Check-in',
  'Documentation',
  'Logistics',
  'Team Lead',
];

function migrationMissing(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('committee_assignments') || (text.includes('does not exist') && text.includes('committee'));
}

const NEEDS_MIGRATION = () => NextResponse.json({
  success: false,
  code: 'NEEDS_MIGRATION',
  message: 'The committee role tables are not in the database yet. Run supabase/migrations/committee_roles_tasks.sql in the Supabase SQL editor.',
}, { status: 503 });

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}

// A role list worth storing: trimmed, de-duplicated, no blanks, capped so one
// pasted paragraph cannot become a role.
function cleanRoles(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = String(raw).split(',');
    }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((r) => String(r || '').trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter((r) => {
      if (!r) return false;
      const key = r.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action,
      resource: 'committee_assignment',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// GET ?actorId=..            -> every assignment, so the Team table can show
//                               each member's events and roles in one read
//     &userId=.. | &eventId=..  -> narrowed to one person, or one event's roster
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    let query = supabase.from('committee_assignments').select(COLUMNS);
    const userId = searchParams.get('userId');
    const eventId = searchParams.get('eventId');
    if (userId) query = query.eq('user_id', userId);
    if (eventId) query = query.eq('event_id', eventId);

    const { data, error } = await query.limit(2000);
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    // The roles actually in use, so the picker can offer them alongside the
    // built-in list without an Admin retyping "Cashier" on every event.
    const used = [...new Set((data || []).flatMap((a) => (Array.isArray(a.roles) ? a.roles : [])).filter(Boolean))];
    const roles = [
      ...DEFAULT_COMMITTEE_ROLES,
      ...used.filter((r) => !DEFAULT_COMMITTEE_ROLES.some((d) => d.toLowerCase() === String(r).toLowerCase())).sort(),
    ];

    return NextResponse.json({ success: true, data: data || [], roles });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT { actorId, userId, eventId, roles: [] }
//   -> set the roles somebody holds on one event. An empty list removes the
//      row: holding no role on an event is the same as not being on it.
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await requireManager(body.actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!body.userId || !body.eventId) {
      return NextResponse.json({ success: false, message: 'userId and eventId are required' }, { status: 400 });
    }

    const roles = cleanRoles(body.roles);

    if (roles.length === 0) {
      const { error } = await supabase.from('committee_assignments')
        .delete().eq('user_id', body.userId).eq('event_id', body.eventId);
      if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });
      await logAudit(actor, 'committee_roles_clear', body.userId, `Cleared roles on event ${body.eventId}`);
      return NextResponse.json({ success: true, data: null, message: 'Roles cleared' });
    }

    // onConflict on (user_id, event_id): setting roles twice updates the row
    // rather than making a second one.
    const { data, error } = await supabase.from('committee_assignments')
      .upsert({
        user_id: body.userId,
        event_id: body.eventId,
        roles,
        assigned_by: actor.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,event_id' })
      .select(COLUMNS).single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    await logAudit(actor, 'committee_roles_set', body.userId, `Roles on event ${body.eventId}: ${roles.join(', ')}`);

    // Told in the main dashboard, because that is where they already are.
    try {
      const { data: evt } = await supabase.from('events').select('title').eq('id', body.eventId).single();
      await supabase.from('notifications').insert({
        user_id: body.userId,
        title: '🎟️ Your committee role',
        message: `You are ${roles.join(' and ')} for ${evt?.title || 'an event'}.`,
        type: 'info',
        link: 'my-profile',
      });
    } catch { /* the assignment stands whether or not anyone was told */ }

    return NextResponse.json({ success: true, data, message: 'Roles saved' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?actorId=..&userId=..[&eventId=..]
//   -> drop one event's roles, or every one of somebody's (when they are
//      removed from the committee altogether)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ success: false, message: 'userId required' }, { status: 400 });

    let query = supabase.from('committee_assignments').delete().eq('user_id', userId);
    const eventId = searchParams.get('eventId');
    if (eventId) query = query.eq('event_id', eventId);

    const { error } = await query;
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : NextResponse.json({ success: false, message: error.message }, { status: 500 });

    await logAudit(actor, 'committee_roles_delete', userId, eventId ? `Removed roles on event ${eventId}` : 'Removed every role');
    return NextResponse.json({ success: true, message: 'Roles removed' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
