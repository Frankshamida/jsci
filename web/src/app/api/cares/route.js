import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/actor';
import { getUserRoles } from '@/lib/permissions';
import { CARE_ROLES, CARE_MIGRATION_NOTE, LIMITS } from '@/lib/joyfulCares';
import { loadCare, publicMember, timelineOf, careTablesMissing, basisOf } from '@/lib/joyfulCaresServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// /api/cares - Joyful Cares (components/cares)
//   GET   ?actorId=..                  ministries, members, Pastors, totals
//   GET   ?actorId=..&memberId=..      one member: their history and notes
//   POST  { actorId, action, memberId, ... }
//           contacted { note? }         reached out (and when)
//           note      { body }          a private note
//           clear     {}                "was there": absences so far no
//                                       longer raise a flag
//           care      { assignedTo?, followUpOn?, note? }   take into care
//           update    { assignedTo?, followUpOn? }          change who / when
//           close     { outcome? }      care done (flags so far cleared too)
// Pastors only (a Super Admin always may). Every action is written to
// care_notes and the audit log.
// ============================================================

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const text = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\r\n?/g, '\n')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const who = await requireRole(params.get('actorId'), CARE_ROLES);
  if (who.error) return bad(who.error, who.status);
  try {
    const data = await loadCare();
    const memberId = params.get('memberId');
    if (memberId) {
      const m = data.members.find((x) => x.id === memberId);
      if (!m) return bad('That member was not found among the ministry members.', 404);
      let notes = [];
      if (data.tablesReady) {
        const { data: rows, error } = await supabaseAdmin.from('care_notes')
          .select('id, kind, body, author_name, created_at').eq('member_id', memberId)
          .order('created_at', { ascending: false }).limit(200);
        if (error && !careTablesMissing(error)) throw error;
        notes = rows || [];
      }
      return NextResponse.json({
        success: true,
        today: data.today,
        tablesReady: data.tablesReady,
        member: { ...publicMember(m), aiFresh: !!m.ai && m.ai.hash === basisOf(m) },
        timeline: timelineOf(m, notes, data.today),
        pastors: data.pastors,
      }, { headers });
    }
    return NextResponse.json({
      success: true,
      today: data.today,
      windowWeeks: data.windowWeeks,
      sundaysRecorded: data.sundaysRecorded,
      tablesReady: data.tablesReady,
      totals: data.totals,
      ministries: data.ministries,
      members: data.members.map((m) => ({ ...publicMember(m), aiFresh: !!m.ai && m.ai.hash === basisOf(m) })),
      pastors: data.pastors,
      me: who.user.id,
    }, { headers });
  } catch (error) {
    console.error('cares GET:', error?.message || error);
    return bad('Joyful Cares could not be loaded just now.', 500);
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const who = await requireRole(body.actorId, CARE_ROLES);
  if (who.error) return bad(who.error, who.status);

  const memberId = String(body.memberId || '');
  const { data: member } = await supabaseAdmin.from('users').select('id, firstname, lastname, is_active').eq('id', memberId).maybeSingle();
  if (!member) return bad('That member was not found.', 404);
  const memberName = [member.firstname, member.lastname].filter(Boolean).join(' ');

  const now = new Date().toISOString();
  const pastorFor = async (id) => {
    if (!id) return { id: null, name: null };
    const { data: p } = await supabaseAdmin.from('users').select('id, firstname, lastname, role, additional_roles, is_active').eq('id', String(id)).maybeSingle();
    if (!p || p.is_active === false || !getUserRoles(p).some((r) => ['Pastor', 'Super Admin'].includes(r))) return null;
    return { id: p.id, name: [p.firstname, p.lastname].filter(Boolean).join(' ') };
  };
  const followUp = (v) => {
    if (v == null || v === '') return { value: null };
    const s = String(v);
    return DATE.test(s) && !Number.isNaN(Date.parse(s)) ? { value: s } : { error: 'Pick a real follow-up date.' };
  };

  let patch;
  let note;
  switch (body.action) {
    case 'contacted': {
      patch = { last_contacted_at: now };
      note = { kind: 'contacted', body: text(body.note, LIMITS.note) || null };
      break;
    }
    case 'note': {
      const b = text(body.body, LIMITS.note);
      if (!b) return bad('Write the note first.');
      note = { kind: 'note', body: b };
      break;
    }
    case 'clear': {
      patch = { cleared_at: now };
      note = { kind: 'cleared', body: text(body.note, LIMITS.note) || 'Marked as all clear: absences so far no longer raise a flag.' };
      break;
    }
    case 'care':
    case 'update': {
      const assignee = body.assignedTo ? await pastorFor(body.assignedTo) : { id: who.user.id, name: who.name };
      if (!assignee) return bad('Pick a Pastor to care for them.');
      const date = followUp(body.followUpOn);
      if (date.error) return bad(date.error);
      patch = { assigned_to: assignee.id, assigned_name: assignee.name, follow_up_on: date.value };
      if (body.action === 'care') {
        patch.in_care = true;
        patch.in_care_since = now;
      }
      const bits = [
        body.action === 'care' ? `Taken into care by ${who.name}` : 'Care updated',
        assignee.name ? `with ${assignee.name}` : null,
        date.value ? `follow up by ${date.value}` : null,
      ].filter(Boolean).join(', ');
      const extra = text(body.note, LIMITS.note);
      note = { kind: body.action === 'care' ? 'care' : 'assigned', body: extra ? `${bits}.\n${extra}` : `${bits}.` };
      break;
    }
    case 'close': {
      patch = { in_care: false, follow_up_on: null, cleared_at: now };
      const outcome = text(body.outcome, LIMITS.outcome);
      note = { kind: 'closed', body: outcome || 'Care closed.' };
      break;
    }
    default:
      return bad('Unknown action.');
  }

  try {
    if (patch) {
      const { error } = await supabaseAdmin.from('care_people')
        .upsert({ member_id: memberId, ...patch, updated_at: now }, { onConflict: 'member_id' });
      if (error) throw error;
    }
    const { data: saved, error: nErr } = await supabaseAdmin.from('care_notes')
      .insert({ member_id: memberId, author_id: who.user.id, author_name: who.name, ...note })
      .select('id, kind, body, author_name, created_at').single();
    if (nErr) throw nErr;
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: who.user.id, user_name: who.name, action: `care_${body.action}`, resource: 'care', resource_id: memberId,
        details: { member: memberName },
      });
    } catch { /* non-fatal */ }
    return NextResponse.json({ success: true, note: saved });
  } catch (error) {
    if (careTablesMissing(error)) return bad(CARE_MIGRATION_NOTE, 503);
    console.error('cares POST:', error?.message || error);
    return bad('That could not be saved just now.', 500);
  }
}
