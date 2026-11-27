// My Profile > My ID: the signed-in person's church ID card.
//
//   GET  ?actorId=..                              what goes on their card
//   POST { actorId, action: 'contact', emergency_name, emergency_phone }
//   POST { actorId, action: 'lost' }              report the printed card lost:
//        a new QR code (the old one stops working), their RFID card turned
//        off, and the church office told to print a new one
//
// The card is issued the first time a verified account opens My ID: a QR code
// and a two-year validity. Needs supabase/migrations/member_id_cards.sql; until
// that is run the card still shows, with no QR, dates or emergency contact
// (ready: false).

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles } from '@/lib/permissions';
import { MINISTRY_ROLES, describeMinistry, parseMinistryCards, parsePastorTitles } from '@/lib/userRoles';
import { ID_MINISTRY_FOR_ROLE, PHONE_RE, idDate } from '@/lib/churchIdCard';

export const dynamic = 'force-dynamic';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const BASE = ['id', 'firstname', 'lastname', 'role', 'additional_roles', 'ministry', 'sub_role', 'member_id', 'life_verse', 'profile_picture', 'status', 'is_active', 'created_at'];
const PREFIX = ['name_prefix'];
const ID_COLS = ['emergency_name', 'emergency_phone', 'id_code', 'id_issued_at', 'id_valid_until', 'id_lost_at'];
const MINISTRY_ROLE_NAMES = ['Ministry Member', 'Song Leader', 'Leader'];
const missingColumn = (e) => Boolean(e) && (e.code === '42703' || /column .* does not exist/i.test(e.message || ''));
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const newCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toUpperCase().slice(0, 8);

// The account, with as many of the newer columns as the database has.
async function loadUser(actorId) {
  const tries = [[...BASE, ...PREFIX, ...ID_COLS], [...BASE, ...ID_COLS], [...BASE, ...PREFIX], BASE];
  for (const cols of tries) {
    const { data, error } = await supabaseAdmin.from('users').select(cols.join(', ')).eq('id', String(actorId)).maybeSingle();
    if (missingColumn(error)) continue;
    if (error) throw error;
    return { user: data, ready: cols.includes('id_code') };
  }
  return { user: null, ready: false };
}

function whyNoCard(user) {
  if (!user || user.is_active === false) return 'Your account is not active.';
  const roles = getUserRoles(user);
  if (!roles.length || roles.every((r) => r === 'Guest')) return 'Church IDs are for members of the church. Ask the church office about becoming a member.';
  if (user.status !== 'Verified') return 'Your ID will appear here once the church office verifies your account.';
  return null;
}

async function ministryHead(name) {
  if (!name) return '';
  const { data } = await supabaseAdmin.from('ministries').select('name, leader_name');
  const row = (data || []).find((m) => key(m.name) === key(name));
  return row?.leader_name || '';
}

// What is printed on the card, by the kind of card.
async function describeCard(user, origin) {
  const roles = getUserRoles(user);
  const name = [user.name_prefix, user.firstname, user.lastname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const { cards } = parseMinistryCards(user.ministry, user.sub_role);
  let kind = 'member';
  if (roles.includes('Pastor')) kind = 'pastor';
  else if (cards.length && roles.some((r) => MINISTRY_ROLE_NAMES.includes(r))) kind = 'ministry';

  const card = {
    kind,
    full_name: name || 'Church member',
    id_no: user.member_id || '',
    photo: user.profile_picture || '',
    life_verse: user.life_verse || '',
    emergency_name: user.emergency_name || '',
    emergency_phone: user.emergency_phone || '',
    issued_date: idDate(user.id_issued_at),
    valid_until: idDate(user.id_valid_until, 'month'),
    valid_until_iso: user.id_valid_until || null,
    lost_at: user.id_lost_at || null,
    qr_value: user.id_code ? `${origin}/id/${user.id_code}` : '',
  };

  if (kind === 'ministry') {
    const first = cards[0];
    const role = MINISTRY_ROLES.find((m) => m.key === first.key);
    const group = describeMinistry(user.ministry, user.sub_role).find((g) => g.key === first.key);
    card.ministry = ID_MINISTRY_FOR_ROLE[first.key] || 'praise-worship';
    card.position = (group?.chips || []).filter(Boolean).join(' · ') || role?.title || '';
    // Dancers have their own ministry in Ministry Management; the rest are named by their role.
    const head = first.key === 'dancer' ? (await ministryHead('Dancers')) || (await ministryHead(role?.ministry)) : await ministryHead(role?.ministry);
    card.ministry_head = head;
  }
  if (kind === 'pastor') {
    card.pastoral_title = parsePastorTitles(user.sub_role)[0] || 'Pastor';
    card.oversees = 'All ministries';
  }
  return card;
}

// First look at My ID: issue the card (a QR code and two years).
async function issueIfNeeded(user) {
  if (user.id_code) return user;
  const issued = new Date();
  const until = new Date(issued);
  until.setFullYear(until.getFullYear() + 2);
  const patch = { id_code: newCode(), id_issued_at: issued.toISOString(), id_valid_until: until.toISOString().slice(0, 10) };
  const { data, error } = await supabaseAdmin.from('users').update(patch).eq('id', user.id).is('id_code', null).select('id_code, id_issued_at, id_valid_until').maybeSingle();
  if (error) throw error;
  if (data) return { ...user, ...data };
  // Issued at the same moment by another tab: read it back.
  const { data: again } = await supabaseAdmin.from('users').select('id_code, id_issued_at, id_valid_until').eq('id', user.id).maybeSingle();
  return { ...user, ...(again || {}) };
}

async function answer(user, ready, origin, extra = {}) {
  const reason = whyNoCard(user);
  if (reason) return NextResponse.json({ success: true, ready, eligible: false, reason, ...extra });
  const card = await describeCard(ready ? await issueIfNeeded(user) : user, origin);
  return NextResponse.json({ success: true, ready, eligible: true, card, ...extra }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const actorId = url.searchParams.get('actorId');
    if (!actorId) return bad('Please sign in again.', 401);
    const { user, ready } = await loadUser(actorId);
    if (!user) return bad('Please sign in again.', 401);
    return await answer(user, ready, url.origin);
  } catch (error) {
    console.error('id-card GET:', error?.message || error);
    return bad('Your ID could not be loaded just now. Please try again.', 500);
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return bad('That request could not be read. Please try again.'); }
  try {
    const origin = new URL(request.url).origin;
    if (!body.actorId) return bad('Please sign in again.', 401);
    const { user, ready } = await loadUser(body.actorId);
    if (!user || user.is_active === false) return bad('Please sign in again.', 401);
    if (!ready) return bad('This needs a small database update first. Please ask the church office.', 409);

    if (body.action === 'contact') {
      const name = String(body.emergency_name ?? '').trim().replace(/\s+/g, ' ');
      const phone = String(body.emergency_phone ?? '').trim().replace(/\s+/g, ' ');
      if (name.length > 80) return bad('Please keep the emergency contact\'s name under 80 characters.');
      if (phone && !PHONE_RE.test(phone)) return bad('Please enter the emergency contact\'s mobile number, like 0917 555 0142.');
      if ((name && !phone) || (phone && !name)) return bad('Please give both a name and a mobile number for your emergency contact.');
      const { error } = await supabaseAdmin.from('users').update({ emergency_name: name || null, emergency_phone: phone || null }).eq('id', user.id);
      if (error) throw error;
      return await answer({ ...user, emergency_name: name, emergency_phone: phone }, ready, origin, { message: 'Emergency contact saved. It is on the back of your ID.' });
    }

    if (body.action === 'lost') {
      if (whyNoCard(user)) return bad('You do not have an ID card yet.');
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin.from('users').update({ id_code: newCode(), id_lost_at: now }).eq('id', user.id);
      if (error) throw error;
      // The printed card also opens doors: turn its RFID off.
      let cardsOff = 0;
      const { data: rfid } = await supabaseAdmin.from('rfid_cards').update({ is_active: false }).eq('user_id', user.id).eq('is_active', true).select('id');
      cardsOff = (rfid || []).length;
      // Tell the church office.
      const { data: staff } = await supabaseAdmin.from('users').select('id, role, additional_roles').neq('is_active', false);
      const admins = (staff || []).filter((u) => getUserRoles(u).some((r) => r === 'Admin' || r === 'Super Admin')).map((u) => u.id);
      const name = [user.firstname, user.lastname].filter(Boolean).join(' ');
      if (admins.length) {
        await supabaseAdmin.from('notifications').insert(admins.map((uid) => ({
          user_id: uid,
          title: 'ID card reported lost',
          message: `${name}${user.member_id ? ` (${user.member_id})` : ''} reported their ID card lost. Its QR code${cardsOff ? ' and RFID tap-in were' : ' was'} turned off. Please print a new card.`,
          type: 'warning',
          link: 'user-management',
        })));
      }
      const { user: fresh } = await loadUser(user.id);
      return await answer(fresh, ready, origin, { message: 'Reported. Your old card no longer works, and the church office will print you a new one.' });
    }

    return bad('Unknown action.');
  } catch (error) {
    console.error('id-card POST:', error?.message || error);
    return bad('That could not be saved just now. Please try again.', 500);
  }
}
