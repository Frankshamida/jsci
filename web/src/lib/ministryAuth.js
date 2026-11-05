// ============================================================
// JSCI Ministry app - sessions
// The phone app never holds a Supabase key. It signs in once at
// /api/ministry/login and gets a signed session token; every /api/ministry/*
// call sends it as "Authorization: Bearer <token>". The token says WHO is
// calling, so the app cannot act as somebody else by changing an id in a
// request (the older /api/lineup/* routes trust the ids they are sent).
//
// Format: base64url(JSON { sub: userId, exp }) + "." + HMAC-SHA256 of it.
// Signed with MINISTRY_APP_SECRET; set it in the Vercel env. Without it the
// key is derived from SUPABASE_SERVICE_ROLE_KEY, which also never leaves the
// server.
// ============================================================
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getUserRoles, ROLES, LEGACY_ROLES } from '@/lib/permissions';

const SESSION_DAYS = 30;

function secret() {
  const own = process.env.MINISTRY_APP_SECRET;
  if (own) return own;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!fallback) throw new Error('Set MINISTRY_APP_SECRET for the JSCI Ministry app.');
  return crypto.createHash('sha256').update(`jsci-ministry:${fallback}`).digest('hex');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

export function issueMinistryToken(userId) {
  const body = b64url(JSON.stringify({ sub: userId, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 }));
  return `${body}.${sign(body)}`;
}

// The user id inside a valid, unexpired token, or null.
export function readMinistryToken(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return sub && exp > Date.now() ? sub : null;
  } catch {
    return null;
  }
}

// Who may use the app: an active, verified Ministry Member (the retired
// Song Leader / Leader roles count, as they became Ministry Member).
const MINISTRY_ROLES = [ROLES.MINISTRY_MEMBER, LEGACY_ROLES.SONG_LEADER, LEGACY_ROLES.LEADER];

export function ministryAccessError(user) {
  if (!user) return 'Account not found.';
  if (user.is_active === false) return 'This account has been deactivated. Contact an admin.';
  if (user.status !== 'Verified') return 'Your account is not verified yet. Please wait for an admin.';
  if (!getUserRoles(user).some((r) => MINISTRY_ROLES.includes(r))) {
    return 'JSCI Ministry is for Ministry Members. Ask an admin to give you the Ministry Member role.';
  }
  return null;
}

export const USER_FIELDS = 'id, member_id, firstname, lastname, email, role, additional_roles, ministry, sub_role, status, is_active, profile_picture, birthdate';

// code 'session_ended': the app signs out (other refusals, like "only the
// Media team can do that", keep you signed in).
const fail = (status, message) => NextResponse.json({ success: false, code: 'session_ended', message }, { status });

/**
 * The signed-in Ministry Member behind a request, re-checked against the
 * database every time (a role taken away mid-session stops the app at once).
 * @returns {Promise<{ user: object } | { response: NextResponse }>}
 */
export async function requireMinistryUser(request) {
  const header = request.headers.get('authorization') || '';
  const userId = readMinistryToken(header.replace(/^Bearer\s+/i, ''));
  if (!userId) return { response: fail(401, 'Please sign in again.') };
  const { data: user } = await supabase.from('users').select(USER_FIELDS).eq('id', userId).maybeSingle();
  const denied = ministryAccessError(user);
  if (denied) return { response: fail(403, denied) };
  return { user };
}

export const fullNameOf = (user) => `${user.firstname} ${user.lastname}`.trim();

// Hand a request on to an existing route handler, as JSON, from the server.
export function internalJson(path, method, body) {
  return new Request(`http://ministry.internal${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
