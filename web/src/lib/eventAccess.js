// Server side of the public event page: which event a slug is, who a QR code
// belongs to, and the signed pass that opens the photos.
//
// Server only - it signs with a secret. The browser half is eventPublic.js.

import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { cached, rateLimit } from '@/lib/serverCache';
import { formatPersonName } from '@/lib/eventFormat';
import { findEventByPublicSlug, publicEventSlugFor } from '@/lib/eventPublic';

export const PUBLIC_EVENT_FIELDS = 'id, title, description, event_date, end_date, location, loc_city, loc_province, loc_region, image_url';

// Registrations that count as "coming": paid, or free and confirmed. The same
// three the door check-in accepts.
export const VERIFIED_STATUSES = ['registered', 'payment_verified', 'paid_pending_turnover'];

export const REG_FIELDS = 'id, event_id, user_id, attendee_name, attendee_firstname, attendee_lastname, status, public_code, deleted_at';

// Every published event, cached briefly: slugs are resolved against the whole
// list, so a clash between two events of the same name can add the year.
const publishedEvents = () => cached('public:events', 120_000, async () => {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select(PUBLIC_EVENT_FIELDS)
    .eq('is_active', true)
    .eq('is_published', true)
    .order('event_date', { ascending: true })
    .limit(300);
  if (error) throw error;
  return data || [];
});

/** The published event a public slug points at, or null. */
export async function eventForPublicSlug(slug) {
  return findEventByPublicSlug(await publishedEvents(), slug);
}

const cleanCode = (code) => {
  const clean = String(code || '').trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(clean) ? clean : '';
};

/** The registration behind a QR code, for this event only. */
export async function registrationForCode(eventId, code) {
  const clean = cleanCode(code);
  if (!eventId || !clean) return null;
  const { data, error } = await supabaseAdmin
    .from('event_registrations')
    .select(REG_FIELDS)
    .eq('event_id', eventId)
    .eq('public_code', clean)
    .is('deleted_at', null)
    .maybeSingle();
  // No public_code column yet (migration not run) reads as "no such code".
  if (error) return null;
  return data || null;
}

/**
 * The event an attendee's code was issued for - their own event - as
 * { event, slug }, or null. An ID only ever opens the event its holder is
 * registered in; this is how a QR that lands on the wrong event's page is
 * sent to the right one.
 */
export async function homeEventForCode(code) {
  const clean = cleanCode(code);
  if (!clean) return null;
  const { data, error } = await supabaseAdmin
    .from('event_registrations')
    .select('event_id')
    .eq('public_code', clean)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return null;
  const events = await publishedEvents();
  const event = events.find((e) => e.id === data.event_id);
  return event ? { event, slug: publicEventSlugFor(event, events) } : null;
}

export const displayName = (reg) => {
  const first = String(reg?.attendee_firstname || '').trim();
  const last = String(reg?.attendee_lastname || '').trim();
  return formatPersonName(first || last ? `${first} ${last}` : reg?.attendee_name);
};

// ---- The photo pass ----
//
// Unlocking hands back a pass: "<eventId>.<registrationId>.<expiry>.<sig>".
// The photos endpoint checks the signature and nothing else, so a pass works
// on any device it is copied to until it expires - which is fine, it only
// opens photos of an event the holder was at.

const PASS_DAYS = 60;
const secret = () => process.env.EVENT_ACCESS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-only-event-access';
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function issuePass(eventId, registrationId) {
  const exp = Math.floor(Date.now() / 1000) + PASS_DAYS * 86400;
  const payload = `${eventId}.${registrationId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

/** { eventId, registrationId } for a valid, unexpired pass for `eventId`; else null. */
export function readPass(pass, eventId) {
  const parts = String(pass || '').split('.');
  if (parts.length !== 4) return null;
  const [ev, reg, exp, sig] = parts;
  const expected = sign(`${ev}.${reg}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (ev !== eventId || Number(exp) < Date.now() / 1000) return null;
  return { eventId: ev, registrationId: reg };
}

// ---- Guessing ----
//
// A last name is not much of a secret, so unlock attempts are limited per
// address and event: 10 in 10 minutes. In memory (see serverCache.js), so it
// slows guessing down rather than being a vault.
export function unlockAllowed(request, eventId) {
  const ip = (request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'local').split(',')[0].trim();
  return rateLimit(`photos-unlock:${eventId}:${ip}`, 10, 10 * 60_000).allowed;
}
