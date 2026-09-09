import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isEventManager, isCommitteeMember } from '@/lib/eventCommittee';

// What an Admin has asked a committee member to do.
//
// Admins write tasks and can change anything about them. The member they
// belong to may read their own and move them along - marking your own work
// done is the whole point of being given it - but not invent tasks for
// themselves or reassign anybody.

const COLUMNS = 'id, user_id, event_id, title, details, due_at, status, created_by, created_by_name, done_at, created_at, updated_at';

export const TASK_STATUSES = ['open', 'doing', 'done', 'cancelled'];

function migrationMissing(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('committee_tasks') || (text.includes('does not exist') && text.includes('committee'));
}

const NEEDS_MIGRATION = () => NextResponse.json({
  success: false,
  code: 'NEEDS_MIGRATION',
  message: 'The committee task table is not in the database yet. Run supabase/migrations/committee_roles_tasks.sql in the Supabase SQL editor.',
}, { status: 503 });

const DENIED = (message = 'Access denied.') => NextResponse.json({ success: false, message }, { status: 403 });
const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

async function requireManager(actorId) {
  const actor = await findEventActor(actorId);
  return isEventManager(actor) ? actor : null;
}

async function requireCommittee(actorId) {
  const actor = await findEventActor(actorId);
  if (!actor || actor.is_active === false) return null;
  return (isEventManager(actor) || isCommitteeMember(actor)) ? actor : null;
}

async function logAudit(actor, action, taskId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action,
      resource: 'committee_task',
      resource_id: taskId ? String(taskId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// GET ?actorId=..                     -> a member's own tasks
//     &all=1[&userId=..&eventId=..]   -> everybody's (Admins)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const wantsAll = searchParams.get('all') === '1';
    const actor = wantsAll
      ? await requireManager(searchParams.get('actorId'))
      : await requireCommittee(searchParams.get('actorId'));
    if (!actor) {
      return DENIED(wantsAll
        ? 'Only Admins and Super Admins can see everybody’s tasks.'
        : 'Only Event Committee members and Admins can open this.');
    }

    let query = supabase.from('committee_tasks').select(COLUMNS)
      .order('status', { ascending: true })
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    // A member sees their own, whatever they ask for.
    if (!wantsAll) query = query.eq('user_id', actor.id);
    else {
      const userId = searchParams.get('userId');
      const eventId = searchParams.get('eventId');
      if (userId) query = query.eq('user_id', userId);
      if (eventId) query = query.eq('event_id', eventId);
    }

    const { data, error } = await query.limit(1000);
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : fail(error.message, 500);

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return fail(error.message, 500);
  }
}

// POST { actorId, userId, eventId?, title, details?, dueAt? }
export async function POST(request) {
  try {
    const body = await request.json();
    const actor = await requireManager(body.actorId);
    if (!actor) return DENIED('Only Admins and Super Admins can assign a task.');

    const title = String(body.title || '').trim();
    if (!body.userId) return fail('Choose who the task is for');
    if (!title) return fail('Give the task a title');

    const { data, error } = await supabase.from('committee_tasks').insert({
      user_id: body.userId,
      event_id: body.eventId || null,
      title: title.slice(0, 160),
      details: String(body.details || '').trim().slice(0, 1000) || null,
      due_at: body.dueAt || null,
      status: 'open',
      created_by: actor.id,
      created_by_name: `${actor.firstname || ''} ${actor.lastname || ''}`.trim() || null,
    }).select(COLUMNS).single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : fail(error.message, 500);

    await logAudit(actor, 'committee_task_create', data.id, `Assigned "${data.title}"`);

    // The person being asked should hear about it where they already are.
    try {
      const { data: evt } = data.event_id
        ? await supabase.from('events').select('title').eq('id', data.event_id).single()
        : { data: null };
      await supabase.from('notifications').insert({
        user_id: data.user_id,
        title: '📋 New committee task',
        message: `${data.title}${evt?.title ? ` — ${evt.title}` : ''}`,
        type: 'info',
        link: 'my-profile',
      });
    } catch { /* the task stands whether or not anyone was told */ }

    return NextResponse.json({ success: true, data, message: 'Task assigned' });
  } catch (error) {
    return fail(error.message, 500);
  }
}

// PUT { actorId, id, status? | title? | details? | dueAt? | eventId? }
//   -> an Admin may change anything; the member it belongs to may move its
//      status along and nothing else.
export async function PUT(request) {
  try {
    const body = await request.json();
    const actor = await findEventActor(body.actorId);
    if (!actor || actor.is_active === false) return DENIED('Could not tell who is signed in. Please sign out and sign in again.');
    const manager = isEventManager(actor);
    if (!manager && !isCommitteeMember(actor)) return DENIED('Only Event Committee members and Admins can do this.');
    if (!body.id) return fail('id required');

    const { data: task } = await supabase.from('committee_tasks').select(COLUMNS).eq('id', body.id).single();
    if (!task) return fail('Task not found', 404);

    const isOwner = String(task.user_id) === String(actor.id);
    if (!manager && !isOwner) return DENIED('That task belongs to somebody else.');

    const patch = {};
    if (body.status !== undefined) {
      if (!TASK_STATUSES.includes(body.status)) return fail('Unknown status');
      patch.status = body.status;
      patch.done_at = body.status === 'done' ? new Date().toISOString() : null;
    }
    if (manager) {
      if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (!title) return fail('Give the task a title');
        patch.title = title.slice(0, 160);
      }
      if (body.details !== undefined) patch.details = String(body.details || '').trim().slice(0, 1000) || null;
      if (body.dueAt !== undefined) patch.due_at = body.dueAt || null;
      if (body.eventId !== undefined) patch.event_id = body.eventId || null;
      if (body.userId !== undefined && body.userId) patch.user_id = body.userId;
    } else if (Object.keys(patch).length === 0) {
      // A member sent something only an Admin may change.
      return DENIED('You can only change whether a task is done.');
    }
    if (Object.keys(patch).length === 0) return fail('Nothing to change');

    const { data, error } = await supabase.from('committee_tasks')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', body.id).select(COLUMNS).single();
    if (error) return migrationMissing(error.message) ? NEEDS_MIGRATION() : fail(error.message, 500);

    await logAudit(actor, 'committee_task_update', data.id, `"${data.title}" → ${Object.keys(patch).join(', ')}`);
    return NextResponse.json({ success: true, data, message: 'Task updated' });
  } catch (error) {
    return fail(error.message, 500);
  }
}

// DELETE ?id=..&actorId=..
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await requireManager(searchParams.get('actorId'));
    if (!actor) return DENIED('Only Admins and Super Admins can delete a task.');
    const id = searchParams.get('id');
    if (!id) return fail('id required');

    const { data: task } = await supabase.from('committee_tasks').select('id, title').eq('id', id).single();
    if (!task) return fail('Task not found', 404);

    const { error } = await supabase.from('committee_tasks').delete().eq('id', id);
    if (error) return fail(error.message, 500);

    await logAudit(actor, 'committee_task_delete', id, `Deleted "${task.title}"`);
    return NextResponse.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    return fail(error.message, 500);
  }
}
