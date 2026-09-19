import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { cached, cacheInvalidate } from '@/lib/serverCache';
import { SLOT_HOLDING_STATUSES, CASH_PENDING_STATUS } from '@/lib/eventSlots';
import { findEventActor, canWorkEvent, actorRoleLabel, staffDeniedMessage } from '@/lib/eventCommittee';
import { resolveCashPayment } from '@/lib/cashPayment';
import {
  addonFeeFor, baseAmountFor, defaultTier, findTier, hasPriceTiers, isNameOnlyTier,
  registerableTiers, representativeTiers,
} from '@/lib/eventPricing';

// Churches are typed by hand, so the same church arrives as "joyful sound church"
// and "Joyful Sound Church". Stored in Title Case so the list stays one entry.
const CHURCH_MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'for', 'a', 'an', 'at', 'on', 'to']);

// Someone with no church to name writes "N/A", "none", "wala" or a dash, and
// the church list ends up with a handful of entries that all mean "no church"
// and each count as one. They are all stored as the same word instead, so the
// list, its counts and the attendance sheet stay about actual churches.
const OTHER_CHURCH = 'Others';
const CHURCH_PLACEHOLDERS = new Set([
  'n/a', 'na', 'n.a', 'n.a.', 'nil', 'none', 'no', 'no church', 'not applicable',
  'not available', 'wala', 'wala pa', 'nothing', 'unknown', 'other', 'others', '-', '--', '.',
]);
function isPlaceholderChurch(name) {
  const t = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
  if (!t) return false;
  return CHURCH_PLACEHOLDERS.has(t) || /^[-_/\.]+$/.test(t);
}

function titleCaseChurch(name) {
  if (isPlaceholderChurch(name)) return OTHER_CHURCH;
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const out = raw.split(' ').map((chunk) => chunk.split('-').map((word, i) => {
    if (!word) return word;
    if (word.length > 1 && word === word.toUpperCase()) return word; // ISOM, JSCI
    const lower = word.toLowerCase();
    if (i !== 0 && CHURCH_MINOR_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('-')).map((w, i) => (i > 0 && CHURCH_MINOR_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// People type their own names in a hurry: "frank gomez", "FRANK GOMEZ". Stored
// the way it should read on a badge - each word capitalised, with the small
// Filipino/Spanish particles (dela, de, van) left lower-case in the middle of a
// name, and O'Brien / Mc / hyphenated names handled.
const NAME_PARTICLES = new Set(['de', 'del', 'dela', 'delos', 'delas', 'da', 'di', 'van', 'von', 'y', 'la', 'las', 'los', 'san', 'santa']);
function titleCaseName(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const capWord = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  return raw.split(' ').map((word, i, all) => {
    const lower = word.toLowerCase();
    // a particle keeps its case only between two other names, never at the ends
    if (i > 0 && i < all.length - 1 && NAME_PARTICLES.has(lower)) return lower;
    return lower
      .split('-').map((part) => part.split("'").map(capWord).join("'")).join('-');
  }).join(' ');
}

// Names are typed by hand on both sides of a duplicate check, so compare them
// with the spacing and casing flattened out.
function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Which of the given names are already registered for an event. Only ever
// answers about the names it was asked about, so it cannot be used to read the
// attendee list of an event.
async function findRegisteredNames(eventId, names) {
  return (await findRegistrationsByName(eventId, names)).map((r) => r.name);
}

// The same lookup, with what the existing registration already knows about that
// person: their church, who to contact, and the extras they are already paying
// for. It is what lets the form offer "you are already registered - use those
// details?" instead of making them retype it.
async function findRegistrationsByName(eventId, names) {
  const wanted = [...new Set((names || []).map(normName).filter(Boolean))];
  if (wanted.length === 0) return [];
  const { data: rows } = await supabase
    .from('event_registrations')
    .select('attendee_name, church_name, church_pastor, attendee_mobile, addons, status, created_at')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5000);
  const byName = new Map();
  (rows || []).forEach((r) => {
    const key = normName(r.attendee_name);
    if (!byName.has(key)) byName.set(key, r); // newest wins - the rows are ordered
  });
  return wanted.filter((n) => byName.has(n)).map((n) => {
    const r = byName.get(n);
    return {
      name: n,
      churchName: r.church_name || '',
      churchPastor: r.church_pastor || '',
      mobile: r.attendee_mobile || '',
      addons: Array.isArray(r.addons) ? r.addons : [],
      status: r.status,
    };
  });
}


// The pending-alerts feed is identical for every admin and is polled in the
// background, so serve it from a short shared cache instead of re-querying per tab.
const PENDING_ALERTS_TTL_MS = 60 * 1000;
const PENDING_ALERTS_KEY = 'events:pending-registrations';

// Columns added by the later migrations. A database that has not run them can
// still take a registration; it just cannot label it.
const OPTIONAL_COLUMNS = [
  'group_ref', 'group_size', 'representative', 'registration_type',
  'added_by', 'added_by_role', 'payment_plan', 'amount_paid',
  'church_name', 'church_pastor', 'base_amount', 'addons', 'price_tier',
  'guardian_registration_id', 'guardian_name',
  'registered_by_user_id',
  'deleted_at', 'deleted_by', 'deleted_by_name', 'deleted_reason',
];

// Of those, the ones a staff-entered registration is meaningless without: they
// are what makes the row say who added it and how it is being paid.
const ATTRIBUTION_COLUMNS = ['added_by', 'added_by_role', 'registration_type', 'payment_plan'];

// PostgREST and Postgres name the offending column in a few different shapes.
// Only a name we recognise as optional counts - anything else is a real error
// and has to be allowed to surface.
function missingOptionalColumn(message) {
  const text = String(message || '');
  const found = text.match(/Could not find the '([^']+)' column/i)
    || text.match(/column "([^"]+)"/i)
    || text.match(/'([^']+)' column/i);
  const name = found && found[1];
  return name && OPTIONAL_COLUMNS.includes(name) ? name : null;
}

// Callers may send a single `id`, or `ids` as an array or a comma-separated
// string. Normalised here so every batch-capable branch reads the same.
function idList(ids, single) {
  const raw = Array.isArray(ids)
    ? ids
    : String(ids || '').split(',');
  const all = [...raw, single].map((v) => String(v || '').trim()).filter(Boolean);
  return [...new Set(all)];
}

async function verifyEventManager(actorId) {
  const actor = await findActor(actorId);
  return actor && EVENT_MANAGER_ROLES.includes(actor.role) ? actor : null;
}

// The account behind an id, whatever its role. Kept separate from the
// permission check so a caller can tell "we do not know who you are" apart
// from "we know, and you are not allowed" - two problems with two different
// answers for the person reading the error.
async function findActor(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabase.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    return data || null;
  } catch { return null; }
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'System',
      action, resource: 'event_registration',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// GET  ?eventId=..            -> all registrations for an event (admin view)
//      ?eventId=..&userId=..  -> this user's registration for one event (status check)
//      ?userId=..             -> ALL of this user's registrations, with event details (My Registrations)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const userId = searchParams.get('userId');
    const pending = searchParams.get('pending');

    // Admin alert feed: new registrations (incl. free) + registrations awaiting payment
    // verification, across all events. 'registered' entries are informational (new sign-up);
    // the client dismisses them once the admin has viewed that event's registrations list.
    if (pending) {
      const actor = await verifyEventManager(searchParams.get('actorId'));
      if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
      const data = await cached(PENDING_ALERTS_KEY, PENDING_ALERTS_TTL_MS, async () => {
        const { data: rows, error } = await supabase
          .from('event_registrations')
          .select('id, attendee_name, status, created_at, cancel_status, cancel_requested_at, refund_due_at, event:events(id, title, is_active)')
          // pending_cash belongs here too: it is money the desk still has to
          // collect, and leaving it out would hide every cash registration
          // from the one place staff look for outstanding payments.
          .in('status', ['payment_submitted', 'pending_payment', 'pending_cash', 'registered'])
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;

        // Somebody asking to get their money back is the most urgent thing an
        // admin can be told about, so cancellation requests ring the same bell -
        // whatever status the registration itself is in.
        let cancels = [];
        try {
          const { data: crows } = await supabase
            .from('event_registrations')
            .select('id, attendee_name, status, created_at, cancel_status, cancel_requested_at, refund_due_at, event:events(id, title, is_active)')
            .eq('cancel_status', 'requested')
            .is('deleted_at', null)
            .order('cancel_requested_at', { ascending: false })
            .limit(100);
          cancels = crows || [];
        } catch { /* the column may predate the migration; the rest still works */ }

        const seen = new Set();
        // A deleted event (is_active false) or one whose row is gone leaves its
        // registrations behind. They must not keep ringing the bell for an event
        // the admin can no longer open.
        return [...cancels, ...(rows || [])].filter((r) => {
          if (!r.event || r.event.is_active === false) return false;
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
      });
      return NextResponse.json({ success: true, count: data.length, data });
    }

    // Church name autocomplete for the public registration form. Returns the
    // churches people have already registered under, most-registered first, so
    // everyone types the SAME full name instead of a dozen spellings of it.
    // ?eventId=..&duplicates=Juan Cruz|Maria Santos -> the ones already registered
    if (searchParams.get('duplicates')) {
      const evId = searchParams.get('eventId');
      if (!evId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
      const asked = searchParams.get('duplicates').split('|').slice(0, 60);
      const found = await findRegistrationsByName(evId, asked);
      // `data` stays a list of names for anything that only needs the yes/no;
      // `details` carries what the form offers to reuse.
      return NextResponse.json({ success: true, data: found.map((r) => r.name), details: found });
    }

    // ?guardians=1&eventId=..&q=..  -> who a child can be registered under.
    //
    // A parent who forgot to add their toddler has to be able to find their own
    // registration, so this answers by name. It is deliberately narrow: at
    // least three characters, at most six answers, and nothing but the name,
    // the church and whether the slot is settled. No contact number, no email,
    // no way to page through the attendee list - enough to recognise the person
    // you already are, and not enough to harvest.
    if (searchParams.get('guardians')) {
      const evId = searchParams.get('eventId');
      if (!evId) return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
      const q = (searchParams.get('q') || '').trim();
      if (q.length < 3) return NextResponse.json({ success: true, data: [] });

      // The children's groups, so a child is never offered as somebody's parent.
      let kidLabels = [];
      try {
        const { data: tierRows } = await supabase
          .from('event_price_tiers').select('label, name_only').eq('event_id', evId);
        kidLabels = (tierRows || []).filter((t) => t.name_only)
          .map((t) => String(t.label || '').trim().toLowerCase());
      } catch { /* no age groups - nobody is a child */ }

      const { data: rows } = await supabase
        .from('event_registrations')
        .select('id, attendee_name, church_name, status, price_tier, created_at')
        .eq('event_id', evId)
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        .ilike('attendee_name', `%${q.replace(/[%_]/g, '')}%`)
        .order('created_at', { ascending: false })
        .limit(30);

      const out = (rows || [])
        .filter((r) => !kidLabels.includes(String(r.price_tier || '').trim().toLowerCase()))
        .slice(0, 6)
        .map((r) => ({
          id: r.id,
          name: r.attendee_name,
          churchName: r.church_name || '',
          status: r.status,
        }));
      return NextResponse.json({ success: true, data: out });
    }

    // ?churches=1&eventId=..&q=..  -> the churches already registered FOR THAT
    // EVENT, most-registered first.
    //
    // Scoped to the one event on purpose. The point of the list is that
    // everybody at an event spells the same church the same way, so its counts
    // and its attendance sheet add up - and a church from a Leyte conference is
    // not an answer to "which church are you from?" at a Cebu one. Offering it
    // there invites somebody to accept a suggestion that has nothing to do with
    // the event they are joining.
    //
    // A new event therefore starts with no suggestions and builds its own list
    // from its first registration onward, which is the intended behaviour.
    if (searchParams.get('churches')) {
      const q = (searchParams.get('q') || '').trim().toLowerCase();
      const scope = searchParams.get('eventId');
      if (!scope) {
        return NextResponse.json({ success: false, message: 'eventId required' }, { status: 400 });
      }
      const { data: rows } = await supabase
        .from('event_registrations')
        .select('church_name')
        .eq('event_id', scope)
        .not('church_name', 'is', null)
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        .limit(2000);
      const counts = new Map();
      (rows || []).forEach((r) => {
        const name = titleCaseChurch(r.church_name);
        if (!name) return;
        const key = name.toLowerCase();
        const hit = counts.get(key);
        if (hit) hit.count += 1;
        else counts.set(key, { name, count: 1 });
      });
      const list = [...counts.values()]
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 8);
      return NextResponse.json({ success: true, data: list });
    }

    if (!eventId && !userId) return NextResponse.json({ success: false, message: 'eventId or userId required' }, { status: 400 });

    // "My Registrations": all of a user's registrations joined with the event.
    // Two kinds of row belong to a member: their own slot (user_id), and every
    // row of a group they booked as the representative (registered_by_user_id).
    // The second only exists once event_group_owner.sql has been run, so a
    // database without it falls back to the slots and simply shows no groups.
    if (!eventId && userId) {
      // payment_* come back too: the Pay Now dialog is built from exactly this
      // row, so without them it has no channels to offer and no instructions
      // to show - a cash entry would be invisible there.
      const withEvent = '*, event:events(id, title, description, image_url, event_date, end_date, location, loc_city, loc_province, latitude, longitude, has_fee, registration_fee, payment_method_ids, payment_methods, payment_instructions)';
      const mine = () => supabase
        .from('event_registrations')
        .select(withEvent)
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      let rows = null;
      // The id goes into a PostgREST filter STRING rather than a bound value,
      // so anything but a plain uuid is not put there - it takes the ordinary
      // equality path instead, where the client cannot shape the filter.
      const grouped = UUID_RE.test(String(userId))
        ? await mine().or(`user_id.eq.${userId},registered_by_user_id.eq.${userId}`)
        : { error: new Error('not a uuid') };
      if (grouped.error) {
        const own = await mine().eq('user_id', userId);
        if (own.error) throw own.error;
        rows = own.data;
      } else {
        rows = grouped.data;
      }
      return NextResponse.json({ success: true, data: rows || [] });
    }

    // The Recycle Bin: what was removed from this event, newest first, each row
    // carrying the installments recorded against it so the admin can see what
    // restoring would bring back before deciding.
    if (searchParams.get('deleted')) {
      const actor = await verifyEventManager(searchParams.get('actorId'));
      if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
      const { data: rows, error: binErr } = await supabase
        .from('event_registrations')
        .select('*')
        .eq('event_id', eventId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });
      if (binErr) throw binErr;

      const ids = (rows || []).map((r) => r.id);
      let payments = [];
      if (ids.length > 0) {
        const { data: pays } = await supabase
          .from('event_registration_payments')
          .select('*')
          .in('registration_id', ids)
          .order('paid_on', { ascending: true });
        payments = pays || [];
      }
      const data = (rows || []).map((r) => ({
        ...r,
        payments: payments.filter((p) => p.registration_id === r.id),
      }));
      return NextResponse.json({ success: true, data });
    }

    let query = supabase.from('event_registrations').select('*').eq('event_id', eventId)
      // Binned rows are hidden here - they live in the Recycle Bin instead.
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/events/registrations  (JSON or multipart with `proof` image)
// Registers the user. Free event -> status 'registered'. Paid -> 'payment_submitted'
// (if a proof/reference was provided) else 'pending_payment'.
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let fields = {};
    let proofUrl = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      for (const [k, v] of form.entries()) { if (k !== 'proof') fields[k] = v; }
      const file = form.get('proof');
      if (file && typeof file === 'object' && file.size > 0) {
        const buffer = await file.arrayBuffer();
        const uploaded = await uploadBufferToCloudinary(buffer, {
          fileName: file.name || 'payment-proof',
          mimeType: file.type || 'application/octet-stream',
          folder: 'JSCI-System/event-payments',
          // 'auto', not 'image': a receipt is whatever the bank handed the
          // payer. A PDF or a .heic sent to the image endpoint is rejected
          // outright, and the registration then fails on the attachment rather
          // than on anything to do with the registration itself.
          resourceType: 'auto',
        });
        proofUrl = uploaded.secureUrl;
      }
    } else {
      fields = await request.json();
    }

    const { eventId, userId, attendeeFirstName, attendeeLastName, attendeeEmail, attendeeMobile, paymentMethod, paymentReference } = fields;
    // attendee_firstname/attendee_lastname are the source of truth; attendee_name is
    // kept alongside (combined) so existing displays/queries don't need to change.
    const firstName = titleCaseName(attendeeFirstName);
    const lastName = titleCaseName(attendeeLastName);
    const attendeeName = titleCaseName(fields.attendeeName || `${firstName} ${lastName}`);

    // Bulk registration: one organiser fills in a roster and pays for everyone at
    // once. Each person still becomes their own registration row - same church,
    // contact and payment - so they each check in with their own QR code.
    // `attendees` is [{ firstName, lastName, addonIds: [] }].
    let roster = fields.attendees;
    if (typeof roster === 'string') { try { roster = JSON.parse(roster); } catch { roster = null; } }
    const isBulk = (Array.isArray(roster) && roster.length > 0) || !!fields.repAddonTopUp;
    const people = isBulk
      ? roster.map((a) => ({
          firstName: titleCaseName(a?.firstName),
          lastName: titleCaseName(a?.lastName),
          addonIds: Array.isArray(a?.addonIds) ? a.addonIds.filter(Boolean) : [],
          // Which age group they were booked under. The price itself is read
          // from the database below - never from what the form sent.
          priceTier: a?.priceTier ? String(a.priceTier) : null,
          // The representative's own place on the roster. A signed-in member's
          // slot has to be theirs - their QR, their cancellation, their
          // "already registered" - so that one row keeps their user_id.
          isRep: !!a?.isRep,
        })).filter((a) => a.firstName || a.lastName)
      : [];
    // Extras the representative is adding to a slot they already hold. A group
    // may be nothing but this, so it counts as something to submit.
    let topUpIds = fields.repAddonTopUp;
    if (typeof topUpIds === 'string') { try { topUpIds = JSON.parse(topUpIds); } catch { topUpIds = []; } }
    topUpIds = Array.isArray(topUpIds) ? topUpIds.filter(Boolean) : [];

    if (isBulk && people.length === 0 && topUpIds.length === 0) {
      return NextResponse.json({ success: false, message: 'Add at least one attendee' }, { status: 400 });
    }

    if (!eventId || (!isBulk && !attendeeName)) {
      return NextResponse.json({ success: false, message: 'Event and attendee name are required' }, { status: 400 });
    }

    // Load the event to apply free/paid + capacity + deadline + audience rules
    const { data: event, error: evErr } = await supabase.from('events')
      .select('id, title, has_fee, registration_fee, early_bird_price, early_bird_deadline, max_participants, registration_deadline, is_active, is_published, allowed_roles, payment_method_ids, payment_methods')
      .eq('id', eventId).single();
    if (evErr || !event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    if (event.is_active === false) return NextResponse.json({ success: false, message: 'This event is no longer available' }, { status: 400 });
    if (event.is_published === false) return NextResponse.json({ success: false, message: 'This event is not open for registration yet' }, { status: 400 });

    // The event's age groups, when it has any. Read here rather than trusted
    // from the form: the price a person is charged must come from the database,
    // whatever the browser sent. A database without the table simply has none,
    // and the event keeps its single registration_fee.
    try {
      const { data: tierRows, error: tierErr } = await supabase
        .from('event_price_tiers').select('*').eq('event_id', eventId).order('position');
      if (!tierErr) event.event_price_tiers = tierRows || [];
    } catch { /* no age groups - the event has one price */ }

    // The account behind the registration, when there is one. Read once: the
    // role decides whether a restricted event is open to them, and the
    // verification status decides whether they may book for other people.
    let memberUser = null;
    if (userId) {
      const { data: u } = await supabase
        .from('users').select('id, firstname, lastname, role, status').eq('id', userId).single();
      memberUser = u || null;
    }

    // Role restriction: if allowed_roles is set, the user's role must be in it
    if (Array.isArray(event.allowed_roles) && event.allowed_roles.length > 0) {
      const role = memberUser?.role || null;
      if (!role || !event.allowed_roles.includes(role)) {
        return NextResponse.json({ success: false, message: 'This event is only open to specific roles.' }, { status: 403 });
      }
    }

    // Booking on other people's behalf from an account is only for an account
    // that has been verified. An unverified member may still register
    // themselves - a slot they hold in their own name is theirs to hold - but
    // filling an event with names nobody has vouched for is not something an
    // unconfirmed account gets to do. Guests (no userId) are unaffected: they
    // are held to the public form's own rules.
    if (isBulk && userId && !fields.addedByAdmin) {
      if (!memberUser) {
        return NextResponse.json({
          success: false,
          message: 'Your account could not be found. Please sign out and sign in again, then try registering the group.',
        }, { status: 401 });
      }
      if (String(memberUser.status) !== 'Verified') {
        return NextResponse.json({
          success: false,
          message: 'Your account needs to be verified before you can register a group. You can still register yourself.',
        }, { status: 403 });
      }
    }

    // Deadline check
    if (event.registration_deadline && new Date() > new Date(event.registration_deadline)) {
      return NextResponse.json({ success: false, message: 'Registration is closed for this event' }, { status: 400 });
    }

    // Capacity check. Counted the same way the "slots available" figure is, or
    // the two would disagree about whether the event is full.
    if (event.max_participants) {
      const { count } = await supabase.from('event_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .in('status', SLOT_HOLDING_STATUSES)
        // Binned registrations released their seat when they were deleted.
        .is('deleted_at', null);
      const seats = isBulk ? people.length : 1;
      const left = event.max_participants - (count || 0);
      if (left < seats) {
        return NextResponse.json({
          success: false,
          message: left <= 0
            ? 'This event is already full'
            : `Only ${left} ${left === 1 ? 'slot is' : 'slots are'} left - please reduce the number of people.`,
        }, { status: 400 });
      }
    }

    // Nobody holds two slots for the same event under one account. A GROUP is
    // the exception, and deliberately so: a member who is already registered
    // may come back to book other people, and their own slot is then left
    // alone rather than counted, charged or refused a second time.
    if (userId && !isBulk) {
      const { data: existing } = await supabase.from('event_registrations')
        .select('id, status').eq('event_id', eventId).eq('user_id', userId).neq('status', 'cancelled').maybeSingle();
      if (existing) return NextResponse.json({ success: false, message: 'You are already registered for this event' }, { status: 409 });
    }

    // Nobody may hold two slots for the same event. Checked here as well as in
    // the form, because the form's check is a convenience and this one is the rule.
    {
      const names = isBulk ? people.map((a) => `${a.firstName} ${a.lastName}`) : [attendeeName];
      const already = await findRegisteredNames(eventId, names);
      if (already.length > 0) {
        const shown = already.map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase()));
        return NextResponse.json({
          success: false,
          message: already.length === 1
            ? `${shown[0]} is already registered for this event.`
            : `These people are already registered for this event: ${shown.join(', ')}.`,
        }, { status: 409 });
      }
      // ...and not twice within the same submission either.
      if (isBulk) {
        const seen = new Set();
        for (const a of people) {
          const key = normName(`${a.firstName} ${a.lastName}`);
          if (seen.has(key)) {
            return NextResponse.json({ success: false, message: 'The same person is on your list more than once.' }, { status: 400 });
          }
          seen.add(key);
        }
      }
    }

    // ---- What each person pays ----
    // An event with age groups prices everybody by the group they were booked
    // under ("Adults ₱300, 6-10 yrs ₱100"); an event without them charges its
    // one registration_fee, exactly as before. Either way the figure is read
    // here, from the database, so a tampered form cannot lower a total.
    let status = 'registered';
    const tiered = hasPriceTiers(event);
    // A group that does not need to register (free toddlers) is not a booking
    // anyone can be put under, so it is never a valid answer from the form.
    const fallbackTier = tiered ? defaultTier(event) : null;
    const resolveTier = (wanted) => {
      if (!tiered) return null;
      const found = findTier(event, wanted);
      return found && found.requiresRegistration ? found : fallbackTier;
    };
    if (tiered && registerableTiers(event).length === 0) {
      return NextResponse.json({
        success: false,
        message: 'This event has no age group open for registration.',
      }, { status: 400 });
    }
    const soloTier = resolveTier(fields.priceTier);
    const baseAmount = event.has_fee || tiered ? baseAmountFor(event, soloTier) : 0;

    // ---- A child, registered under whoever brought them ----
    // A children's group asks for a name and nothing else, so the church, the
    // pastor and the number to ring all come from the parent's own registration
    // for this event. Read from the database rather than the form: the point of
    // picking a parent is that their details are already right.
    let guardian = null;
    if (fields.guardianRegistrationId) {
      const { data: g } = await supabase
        .from('event_registrations')
        .select('id, event_id, attendee_name, church_name, church_pastor, attendee_mobile, status, deleted_at')
        .eq('id', String(fields.guardianRegistrationId))
        .maybeSingle();
      if (!g || g.event_id !== eventId || g.deleted_at || g.status === 'cancelled') {
        return NextResponse.json({
          success: false,
          message: 'That parent or guardian is not registered for this event. Please search for them again.',
        }, { status: 400 });
      }
      guardian = g;
    }
    // Registering a child on their own without saying whose they are would put
    // a name on the attendance sheet that nobody at the desk can place.
    if (!isBulk && isNameOnlyTier(soloTier) && !guardian) {
      return NextResponse.json({
        success: false,
        message: `A ${soloTier.label} registration has to be under a parent or guardian. Please search for the person who is bringing them.`,
      }, { status: 400 });
    }

    // Paid add-ons. The client sends only the IDs it ticked; the prices are read
    // back from the DB here so a tampered form can never lower the total. The
    // chosen ones are snapshotted onto the registration so the receipt still
    // reads correctly if the admin later renames or reprices a question.
    const { data: addonRows } = await supabase
      .from('event_addons').select('*').eq('event_id', eventId);
    // Required add-ons are always charged, whether or not they were sent. The
    // fee is the one for THEIR age group where the add-on has one - a child's
    // accommodation can cost less than an adult's on the same event.
    const pickAddons = (ids, tier) => (addonRows || [])
      .filter((a) => a.is_required || (ids || []).includes(a.id))
      .map((a) => ({ id: a.id, question: a.question, fee: addonFeeFor(a, tier) }));

    let singleIds = fields.addonIds;
    if (typeof singleIds === 'string') {
      try { singleIds = JSON.parse(singleIds); } catch { singleIds = singleIds.split(',').map((v) => v.trim()); }
    }
    singleIds = Array.isArray(singleIds) ? singleIds.filter(Boolean) : [];

    const chosenAddons = pickAddons(singleIds, soloTier);
    const addonTotal = chosenAddons.reduce((sum, a) => sum + a.fee, 0);
    const amount = baseAmount + addonTotal;

    // In a group the extras AND the age group are per person, so everyone is
    // priced on their own line and the payment covers the sum of them.
    // A 7-year-old cannot hold a booking for eleven people, so the
    // representative's own line is priced as an adult whatever the form sent.
    const repTierFallback = tiered ? (representativeTiers(event)[0] || fallbackTier) : null;
    const priced = people.map((a) => {
      const wanted = resolveTier(a.priceTier);
      const tier = a.isRep && isNameOnlyTier(wanted) ? repTierFallback : wanted;
      const addons = pickAddons(a.addonIds, tier);
      const personBase = event.has_fee || tiered ? baseAmountFor(event, tier) : 0;
      return {
        ...a,
        tier,
        addons,
        baseAmount: personBase,
        amount: personBase + addons.reduce((sum, x) => sum + x.fee, 0),
      };
    });
    const groupTotal = priced.reduce((sum, a) => sum + a.amount, 0);

    // An otherwise-free event still has to be paid for once a paid add-on is picked.
    // A group's bill is everyone on the roster plus anything the representative
    // is availing on the slot they already hold.
    const topUpTotal = (addonRows || [])
      .filter((a) => topUpIds.includes(a.id))
      .reduce((sum, a) => sum + addonFeeFor(a, soloTier), 0);
    const dueNow = isBulk ? groupTotal + topUpTotal : amount;
    // Cash is decided by the METHOD, not by whether a receipt turned up: there
    // is never going to be one. It holds the seat (see lib/eventSlots) but is
    // not 'payment_submitted' - there is nothing submitted for an admin to
    // check, and telling the verification queue otherwise would fill it with
    // rows that have no proof to look at.
    const cashPay = dueNow > 0 ? await resolveCashPayment(event, paymentMethod) : { isCash: false, name: null };
    if (dueNow > 0) {
      status = cashPay.isCash
        ? CASH_PENDING_STATUS
        : ((proofUrl || paymentReference) ? 'payment_submitted' : 'pending_payment');
    }

    // One id shared by every row of the same group, so the admin can see the
    // five people who arrived on one payment as one booking.
    const groupRef = isBulk ? `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : null;

    // How this registration came to be, and whose name is on having made it:
    //   bulk       -> a representative registering a group
    //   admin      -> staff entering a walk-in on someone's behalf
    //   individual -> the attendee themselves
    // The TYPE is always about how many people this covers - one, or a group.
    // WHO entered it is a separate question, answered by added_by_role.
    const registrationType = isBulk ? 'bulk' : 'individual';

    // "Added by Super Admin" is a record of who did this, so the role and the
    // name are read from the logged-in account rather than taken from the form.
    //
    // If that account cannot be confirmed, the request is REFUSED rather than
    // saved under the attendee's own name. A silent fallback here is what makes
    // a walk-in entered by staff show up as though the attendee registered
    // themselves - a wrong row that nobody notices beats no row that says why.
    const addedByAdmin = !!fields.addedByAdmin;
    let adminActor = null;
    if (addedByAdmin) {
      // findEventActor rather than findActor: this needs the committee flags
      // alongside the role to answer "may you add someone to THIS event".
      const who = await findEventActor(fields.actorId);
      if (!who) {
        return NextResponse.json({
          success: false,
          message: fields.actorId
            ? 'Your account could not be found. Please sign out and sign in again, then add the attendee.'
            : 'Could not tell who is signed in. Please sign out and sign in again, then add the attendee.',
        }, { status: 401 });
      }
      if (!canWorkEvent(who, eventId)) {
        return NextResponse.json({ success: false, message: staffDeniedMessage(who) }, { status: 403 });
      }
      adminActor = who;
    }

    const addedByRole = adminActor
      ? actorRoleLabel(adminActor)                   // 'Admin' | 'Super Admin' | 'Event Committee'
      : (isBulk ? 'Representative' : 'Attendee');
    const addedByName = (() => {
      // The staff member's own name, so the row reads "Super Admin / Frank
      // Gomez" and never the name of the person being added.
      if (adminActor) return titleCaseName(`${adminActor.firstname} ${adminActor.lastname}`.trim()) || addedByRole;
      if (isBulk) return titleCaseName(fields.representative || attendeeName) || null;
      return attendeeName || null;
    })();

    // ---- What the registration's status should say ----
    // An installment plan is never "waiting for someone to check a payment" -
    // it is being paid down, and it says so until the payments add up. Its own
    // status, rather than borrowing 'payment_submitted', so the bell, the
    // filters and the bin all read it the same way.
    if (fields.paymentPlan === 'flexible' && dueNow > 0) {
      status = 'installment';
    } else if (addedByAdmin && dueNow > 0 && fields.markVerified !== false) {
      // Staff entering a walk-in ARE the verification: the money was handed
      // over in front of the person recording it, so there is nobody left to
      // check it. Pay-in-full is paid. Unticking "already collected" on the
      // form is the way to say the money has not arrived yet.
      status = 'payment_verified';
    }

    // Everything the whole group shares - typed once by the organiser.
    const shared = {
      event_id: eventId,
      attendee_email: attendeeEmail || null,
      attendee_mobile: (guardian ? guardian.attendee_mobile : attendeeMobile) || null,
      // who to call about this booking - the person who filled in the form
      representative: isBulk ? (titleCaseName(fields.representative || attendeeName) || null) : null,
      church_name: titleCaseChurch(guardian ? guardian.church_name : fields.churchName) || null,
      // stored as "Ptr. Juan Dela Cruz" however it was typed
      church_pastor: (() => {
        const source = guardian ? guardian.church_pastor : fields.churchPastor;
        const bare = titleCaseName(String(source || '').replace(/^ptr\.?\s*/i, ''));
        return bare ? `Ptr. ${bare}` : null;
      })(),
      registration_type: registrationType,
      added_by: addedByName,
      added_by_role: addedByRole,
      // 'flexible' means this will be settled over several payments, recorded
      // against the registration in event_registration_payments.
      payment_plan: fields.paymentPlan === 'flexible' ? 'flexible' : 'full',
      // The channel's own spelling of its name, so renaming it later cannot
      // leave two spellings of one account across the registration list.
      payment_method: (cashPay.isCash ? cashPay.name : paymentMethod) || null,
      // A cash row must never carry these. Someone who typed a reference and
      // then switched the picker to Cash would otherwise save a row that reads
      // as an online payment to every screen and every cash/online total.
      payment_reference: cashPay.isCash ? null : (paymentReference || null),
      payment_proof_url: cashPay.isCash ? null : proofUrl,
      status,
      ...(status === 'payment_verified' && adminActor
        ? { verified_by: adminActor.id, verified_at: new Date().toISOString() }
        : {}),
    };

    // Whose slot is whose in a group. Every row is stamped with the account
    // that booked it - that is what lets the representative see the whole
    // group in My Registrations - but only the representative's own row is
    // stamped as BEING theirs, because only that one is a seat they occupy.
    //
    // A representative who is not attending has no such row: booking a group is
    // not the same as going to the event, and a member may be sending people
    // without taking a slot or paying a fee themselves. `repAttending: '0'` says
    // so, and it also switches OFF the match-by-name below - otherwise a
    // namesake on the roster would be handed this account's slot.
    const repAttending = !(fields.repAttending === false
      || fields.repAttending === '0' || fields.repAttending === 'false');
    const repKey = normName(fields.representative || attendeeName);
    const rows = isBulk
      ? priced.map((a) => ({
          ...shared,
          user_id: (userId && repAttending && (a.isRep || normName(`${a.firstName} ${a.lastName}`) === repKey)) ? userId : null,
          registered_by_user_id: userId || null,
          attendee_firstname: a.firstName || null,
          attendee_lastname: a.lastName || null,
          attendee_name: `${a.firstName} ${a.lastName}`.trim(),
          // Each person on their own price: in a family booking the adult and
          // the 8-year-old are on one payment but not on one fee.
          base_amount: a.baseAmount,
          price_tier: a.tier ? a.tier.label : null,
          // A child on a group booking belongs to the person who made it -
          // there is no separate parent to look for.
          guardian_name: isNameOnlyTier(a.tier)
            ? (titleCaseName(fields.representative || attendeeName) || null)
            : null,
          amount: a.amount,
          addons: a.addons,
          group_ref: groupRef,
          group_size: priced.length,
        }))
      : [{
          ...shared,
          user_id: userId || null,
          attendee_firstname: firstName || null,
          attendee_lastname: lastName || null,
          attendee_name: attendeeName,
          base_amount: baseAmount,
          price_tier: soloTier ? soloTier.label : null,
          guardian_registration_id: guardian ? guardian.id : null,
          guardian_name: guardian ? guardian.attendee_name : null,
          amount,
          addons: chosenAddons,
        }];

    let inserted = [];
    let columnWarning = null;
    const droppedColumns = [];
    if (rows.length > 0) {
      // Retry per column, and only for the column the database actually
      // complained about. The old version stripped every optional column on any
      // error mentioning "column", so a grumble about one of them cost us all
      // of them - which is how a staff-entered walk-in ended up with no
      // `added_by`, no `payment_plan` and no way to tell that had happened.
      let attempt = rows;
      for (;;) {
        const { data, error } = await supabase.from('event_registrations').insert(attempt).select();
        if (!error) { inserted = data || []; break; }
        const missing = missingOptionalColumn(error.message);
        // Anything that is not a known-optional column is a real failure. Saving
        // a half-written row would bury it.
        if (!missing || droppedColumns.includes(missing)) throw error;
        droppedColumns.push(missing);
        attempt = attempt.map(({ [missing]: _drop, ...rest }) => rest);
      }
    }

    // Losing the attribution is not cosmetic on a staff-entered row: the whole
    // point of the entry is that it records who made it and how they are
    // paying. Rather than save a row that says the attendee registered
    // themselves, the entry is undone and the reason is reported.
    const lostLabels = droppedColumns.filter((c) => ATTRIBUTION_COLUMNS.includes(c));
    if (addedByAdmin && lostLabels.length > 0) {
      if (inserted.length > 0) {
        await supabase.from('event_registrations').delete().in('id', inserted.map((r) => r.id));
      }
      return NextResponse.json({
        success: false,
        message: `This database is missing the ${lostLabels.map((c) => `"${c}"`).join(', ')} column${lostLabels.length > 1 ? 's' : ''}, `
          + 'so the attendee could not be recorded as added by you. Nothing was saved. Run '
          + 'supabase/migrations/event_bulk_registration.sql and event_flexible_payment.sql, then add the attendee again.',
      }, { status: 500 });
    }
    if (droppedColumns.length > 0) {
      // A guest registering for themselves is not blocked by a missing label
      // column - their slot matters more than the labelling - but the gap is
      // still reported rather than left to look like a feature not working.
      columnWarning = `Saved, but this database is missing the ${droppedColumns.map((c) => `"${c}"`).join(', ')} `
        + `column${droppedColumns.length > 1 ? 's' : ''}. Run supabase/migrations/event_registrations_columns.sql `
        + 'to record them.';
      // This one has a consequence worth naming: without it the rows are saved
      // but nothing ties them to the account that booked them, so the group
      // will not appear under My Registrations.
      if (isBulk && userId && droppedColumns.includes('registered_by_user_id')) {
        columnWarning += ' Everyone on your list is registered, but the group will not show under'
          + ' My Registrations until that column exists.';
      }
    }

    // The representative may be availing an extra on a slot they already hold -
    // no new seat, just more owed on the registration they have. Their row is
    // updated and put back for verification, since fresh money is due.
    if (isBulk && topUpIds.length > 0) {
      const repName = normName(fields.representative || attendeeName);
      const { data: candidates } = await supabase
        .from('event_registrations')
        .select('id, user_id, attendee_name, addons, amount, amount_paid, payment_plan, status')
        .eq('event_id', eventId)
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5000);
      // A signed-in representative's slot is known by their account, not by
      // how their name happens to be spelled on it - two members can share a
      // name, and one of them should not be able to buy extras on the other's
      // registration. The name match stays for guests, who have no account.
      const target = (userId && (candidates || []).find((r) => String(r.user_id) === String(userId)))
        || (candidates || []).find((r) => normName(r.attendee_name) === repName);
      if (target) {
        const held = Array.isArray(target.addons) ? target.addons : [];
        const heldIds = new Set(held.map((a) => a.id));
        const added = (addonRows || [])
          .filter((a) => topUpIds.includes(a.id) && !heldIds.has(a.id))
          .map((a) => ({ id: a.id, question: a.question, fee: Number(a.fee) || 0 }));
        if (added.length > 0) {
          const extra = added.reduce((sum, a) => sum + a.fee, 0);
          const owedAfter = (Number(target.amount) || 0) + extra;
          const patch = {
            addons: [...held, ...added],
            amount: owedAfter,
          };

          // What the extra money does to the registration's status depends on
          // who added it and how the registration is being settled.
          if (target.payment_plan === 'flexible') {
            // The plan simply owes more now. It stays a plan, and settles when
            // the payments catch up with the new total.
            const paidSoFar = Number(target.amount_paid) || 0;
            patch.status = paidSoFar >= owedAfter ? 'payment_verified' : 'installment';
            if (patch.status === 'installment') { patch.verified_by = null; patch.verified_at = null; }
          } else if (adminActor) {
            // Staff took the extra payment at the desk, so there is nobody left
            // to verify it - the same rule as any other walk-in entry.
            patch.status = 'payment_verified';
            patch.verified_by = adminActor.id;
            patch.verified_at = new Date().toISOString();
          } else if (cashPay.isCash) {
            // Topping up in cash: still nothing submitted to check, still a
            // seat held, still money owed at the desk.
            patch.status = CASH_PENDING_STATUS;
            patch.verified_by = null;
            patch.verified_at = null;
          } else {
            // A guest adding an extra owes fresh money that has to be checked.
            patch.status = 'payment_submitted';
            patch.verified_by = null;
            patch.verified_at = null;
          }
          // Cleared rather than merely left alone: a row now being settled in
          // cash must not keep the reference and receipt of the bank payment
          // that came before it.
          if (cashPay.isCash) {
            patch.payment_method = cashPay.name;
            patch.payment_reference = null;
            patch.payment_proof_url = null;
          } else {
            if (paymentReference) patch.payment_reference = paymentReference;
            if (proofUrl) patch.payment_proof_url = proofUrl;
          }
          await supabase.from('event_registrations').update(patch).eq('id', target.id);
          await logAudit(adminActor, 'event_registration_update', target.id,
            `${fields.representative || attendeeName} added ${added.map((a) => a.question).join(', ')} (+P${extra}) to their registration for "${event.title}"`);
        }
      }
    }

    // The first installment, handed over as the walk-in was recorded.
    const firstPayment = Number(fields.initialPayment) || 0;
    if (firstPayment > 0 && inserted.length === 1) {
      try {
        await supabase.from('event_registration_payments').insert({
          registration_id: inserted[0].id,
          amount: firstPayment,
          paid_on: new Date().toISOString().slice(0, 10),
          method: paymentMethod || null,
          reference: paymentReference || null,
          note: 'Recorded with the registration',
          recorded_by_name: addedByName,
        });
        // Somebody can pick a plan and then hand over the whole amount anyway.
        // That is a settled registration, not a plan with nothing left on it.
        const owedNow = Number(inserted[0].amount) || 0;
        await supabase.from('event_registrations')
          .update({
            amount_paid: firstPayment,
            ...(owedNow > 0 && firstPayment >= owedNow ? { status: 'payment_verified' } : {}),
          })
          .eq('id', inserted[0].id);
      } catch { /* the registration itself is saved; the payment can be added again */ }
    }

    // A new registration must show on the admin bell immediately.
    cacheInvalidate(PENDING_ALERTS_KEY);
    if (isBulk) {
      if (inserted.length > 0) {
        await logAudit(null, 'event_register', inserted[0].id, `${priced.length} attendees registered for "${event.title}" by ${attendeeName || 'a guest'} (${status})`);
      }
      return NextResponse.json({
        success: true,
        data: inserted,
        warning: columnWarning,
        count: inserted.length,
        message: inserted.length === 0
          // Nobody new was registered - this was extras added to a slot that
          // already existed. Staff took the money, so nothing is pending.
          ? (adminActor ? 'Extras added to their registration.' : 'Your extras have been submitted for verification.')
          : (groupTotal > 0
            ? `${inserted.length} registrations submitted`
            : `${inserted.length} people are registered!`),
      });
    }
    const data = inserted[0];
    await logAudit(null, 'event_register', data.id, `${attendeeName} registered for "${event.title}" (${status})`);
    return NextResponse.json({
      success: true, data, warning: columnWarning,
      message: amount > 0 ? 'Registration submitted' : 'You are registered!',
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT /api/events/registrations  { id, actorId, status }            -> staff verifies/updates a registration
//                                { id, actorId, attended: true|false } -> staff marks/clears attendance (QR check-in)
//   "staff" = an Admin/Super Admin, or an Event Committee member assigned to
//   that registration's event. The bin actions and the edit below stay Admin-only.
//                                { id, actorId, action: 'add_addons', addonIds, paymentMethod, paymentReference, collectNow }
//                                                                     -> staff add an extra the attendee forgot to avail, and take the money for it
//                                { id, actorId, action: 'edit_details', details } -> admin corrects who the attendee is
//                                { id, actorId, action: 'soft_delete', reason } -> admin moves it to the Recycle Bin
//                                { id, actorId, action: 'restore' }   -> admin brings it back out of the bin
// DELETE /api/events/registrations?id=..&userId=..  -> a member cancels their OWN registration
//        /api/events/registrations?id=..&actorId=..&purge=1      -> admin permanently deletes a binned registration
//        /api/events/registrations?ids=a,b,c&actorId=..&purge=1   -> ...or several at once
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');

    // Emptying the bin: the only path that destroys anything. Restricted to a
    // row that is already binned, so a live registration can never be wiped by
    // a stray request - it has to be deleted, seen in the bin, and deleted again.
    if (searchParams.get('purge')) {
      const actor = await verifyEventManager(searchParams.get('actorId'));
      if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
      const wanted = idList(searchParams.get('ids'), id);
      if (wanted.length === 0) return NextResponse.json({ success: false, message: 'id or ids required' }, { status: 400 });

      const { data: regs } = await supabase
        .from('event_registrations')
        .select('id, attendee_name, amount, amount_paid, deleted_at')
        .in('id', wanted);
      if (!regs || regs.length === 0) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });

      // Only ever destroys what is already in the bin. A live registration
      // cannot be wiped by a stray id in a list - it has to be deleted, seen in
      // the bin, and deleted again.
      const binned = regs.filter((r) => r.deleted_at);
      const skipped = regs.length - binned.length;
      if (binned.length === 0) {
        return NextResponse.json({
          success: false,
          message: 'Move the registration to the Recycle Bin first.',
        }, { status: 400 });
      }

      // The installment rows cascade with the registration, so the money
      // recorded against it goes too - which is why the UI shows it first.
      const { error: purgeErr } = await supabase
        .from('event_registrations').delete().in('id', binned.map((r) => r.id));
      if (purgeErr) throw purgeErr;

      cacheInvalidate(PENDING_ALERTS_KEY);
      for (const r of binned) {
        await logAudit(actor, 'event_registration_purge', r.id,
          `Permanently deleted ${r.attendee_name} (₱${Number(r.amount_paid) || 0} of ₱${Number(r.amount) || 0} recorded)`);
      }

      const n = binned.length;
      return NextResponse.json({
        success: true,
        count: n,
        message: (n === 1
          ? 'Registration permanently deleted'
          : `${n} registrations permanently deleted`)
          // Said out loud rather than quietly ignored, so a selection that did
          // not do what was expected is visible.
          + (skipped > 0 ? ` — ${skipped} skipped (not in the Recycle Bin)` : ''),
      });
    }

    if (!id || !userId) return NextResponse.json({ success: false, message: 'id and userId required' }, { status: 400 });

    // Ownership check: the registration must belong to this user
    const { data: reg, error: regErr } = await supabase
      .from('event_registrations').select('id, user_id, status').eq('id', id).single();
    if (regErr || !reg) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });
    if (reg.user_id !== userId) return NextResponse.json({ success: false, message: 'You can only cancel your own registration.' }, { status: 403 });
    if (reg.status === 'cancelled') return NextResponse.json({ success: true, message: 'Already cancelled' });

    const { error } = await supabase.from('event_registrations').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
    cacheInvalidate(PENDING_ALERTS_KEY);
    return NextResponse.json({ success: true, message: 'Registration cancelled' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ids, actorId, status, attended, action, reason } = body;
    if (!id && !(Array.isArray(ids) && ids.length > 0)) {
      return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    }
    if (!status && attended === undefined && !action) return NextResponse.json({ success: false, message: 'status, attended or action required' }, { status: 400 });

    // Two different gates, because these are two different kinds of change.
    // Binning a registration destroys work, and rewriting an attendee's details
    // rewrites the record itself - both are an Admin's call. Checking someone in
    // at the door, confirming the money they handed over, and taking payment for
    // an extra they forgot to avail are the committee's whole job. So those
    // three keep the Admin-only check, and everything else asks whether this
    // person may work THIS event.
    const adminOnly = action === 'soft_delete' || action === 'restore' || action === 'edit_details';
    let actor;
    if (adminOnly) {
      actor = await verifyEventManager(actorId);
      if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
      // Only the bin actions work on a batch - everything else is one row, and
      // the branch below has nothing to look up without an id.
      if (action === 'edit_details' && !id) {
        return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
      }
    } else {
      // Only the bin actions work on a batch; a status or attendance change is
      // always one registration. Said out loud rather than left to fail later
      // on an `id` that was never sent - and it is what makes the scope check
      // below meaningful, since there is exactly one event to check against.
      if (!id) {
        return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
      }
      // Which event this registration belongs to decides whether a committee
      // member scoped to particular events is allowed near it.
      const { data: owner } = await supabase.from('event_registrations').select('event_id').eq('id', id).single();
      const who = await findEventActor(actorId);
      if (!canWorkEvent(who, owner?.event_id)) {
        return NextResponse.json({ success: false, message: staffDeniedMessage(who) }, { status: 403 });
      }
      actor = who;
    }

    // Moving a registration to the Recycle Bin, or bringing it back out. Nothing
    // about the registration itself changes - not its status, not the payments
    // recorded against it - only whether it is in the bin, so a restore puts
    // back exactly what was removed.
    if (action === 'soft_delete' || action === 'restore') {
      // One id or many - the work is identical, so the batch case is the only
      // case and a single id is just a batch of one.
      const wanted = idList(ids, id);
      if (wanted.length === 0) return NextResponse.json({ success: false, message: 'id or ids required' }, { status: 400 });

      const { data: regs } = await supabase
        .from('event_registrations')
        .select('id, attendee_name, amount, amount_paid, deleted_at')
        .in('id', wanted);
      if (!regs || regs.length === 0) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });

      const removing = action === 'soft_delete';
      // Rows already in the state being asked for are skipped rather than
      // failing the whole batch - selecting one twice is not an error.
      const todo = regs.filter((r) => (removing ? !r.deleted_at : !!r.deleted_at));
      if (todo.length === 0) {
        return NextResponse.json({
          success: true,
          count: 0,
          message: removing ? 'Already in the Recycle Bin' : 'Nothing there to restore',
        });
      }

      const patch = removing
        ? {
            deleted_at: new Date().toISOString(),
            deleted_by: actor.id,
            deleted_by_name: `${actor.firstname} ${actor.lastname}`.trim(),
            deleted_reason: (reason || '').trim() || null,
          }
        : { deleted_at: null, deleted_by: null, deleted_by_name: null, deleted_reason: null };

      const { data: saved, error: binErr } = await supabase
        .from('event_registrations').update(patch).in('id', todo.map((r) => r.id)).select();
      if (binErr) throw binErr;

      cacheInvalidate(PENDING_ALERTS_KEY);
      // One audit entry per registration: the log is read to find out what
      // happened to a particular person, not to count batches.
      for (const r of todo) {
        await logAudit(
          actor,
          removing ? 'event_registration_soft_delete' : 'event_registration_restore',
          r.id,
          removing
            ? `Moved ${r.attendee_name} to the Recycle Bin (₱${Number(r.amount_paid) || 0} of ₱${Number(r.amount) || 0} recorded)${(reason || '').trim() ? ` — ${reason.trim()}` : ''}`
            : `Restored ${r.attendee_name} from the Recycle Bin`,
        );
      }

      const n = todo.length;
      return NextResponse.json({
        success: true,
        data: n === 1 ? (saved || [])[0] : saved,
        count: n,
        message: removing
          ? (n === 1 ? 'Moved to Recycle Bin' : `${n} registrations moved to the Recycle Bin`)
          : (n === 1 ? 'Registration restored' : `${n} registrations restored`),
      });
    }

    // Correcting what a registration SAYS about someone: their name, their
    // church, how to reach them, and the payment details typed off a receipt.
    // Nothing about the money owed changes here - only the record of who this
    // is. Admin-only, because a row is read by the door, the room list and the
    // receipt, and rewriting it rewrites all three.
    if (action === 'edit_details') {
      const d = body.details || {};
      const { data: reg } = await supabase
        .from('event_registrations')
        .select('id, event_id, group_ref, attendee_name, attendee_email, attendee_mobile, church_name, church_pastor, representative, payment_method, payment_reference, price_tier, status, deleted_at')
        .eq('id', id).single();
      if (!reg) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });
      if (reg.deleted_at) {
        return NextResponse.json({
          success: false,
          message: 'This registration is in the Recycle Bin. Restore it first, then edit it.',
        }, { status: 400 });
      }

      // Stored the way every other entry point stores it, so an edited row and
      // a freshly registered one are spelled the same.
      const first = titleCaseName(d.attendeeFirstName);
      const last = titleCaseName(d.attendeeLastName);
      const name = `${first} ${last}`.trim();
      const church = titleCaseChurch(d.churchName);
      const pastorBare = titleCaseName(String(d.churchPastor || '').replace(/^ptr\.?\s*/i, ''));
      const mobile = String(d.attendeeMobile || '').replace(/\D/g, '');
      const email = String(d.attendeeEmail || '').trim();

      // The same fields the entry forms insist on, so an edit cannot leave a row
      // in a state the form would have refused to create.
      const errors = {};
      if (!first) errors.firstName = 'First name is required.';
      if (!last) errors.lastName = 'Last name is required.';
      if (!church) errors.churchName = 'Church name is required.';
      if (!pastorBare) errors.churchPastor = 'Church pastor is required.';
      if (mobile && !/^09\d{9}$/.test(mobile)) errors.mobile = 'Contact number must be 11 digits starting with 09.';
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'That email address does not look right.';
      if (Object.keys(errors).length > 0) {
        return NextResponse.json({ success: false, errors, message: 'Please correct the highlighted fields.' }, { status: 400 });
      }

      // Renaming somebody onto a name that already holds a slot would put two
      // registrations on one person - the rule the entry forms follow, applied
      // here too. Only asked when the name actually changed, or every save
      // would collide with the row being saved.
      if (normName(name) !== normName(reg.attendee_name)) {
        const clash = await findRegistrationsByName(reg.event_id, [name]);
        if (clash.length > 0) {
          return NextResponse.json({
            success: false,
            errors: { firstName: 'This person already has a registration for this event.' },
            message: `${name} is already registered for this event.`,
          }, { status: 409 });
        }
      }

      const patch = {
        attendee_firstname: first || null,
        attendee_lastname: last || null,
        attendee_name: name,
        attendee_email: email || null,
        attendee_mobile: mobile || null,
        church_name: church || null,
        church_pastor: pastorBare ? `Ptr. ${pastorBare}` : null,
      };
      // The payment's own details are correctable here as well: a reference read
      // off a screenshot is the field most often wrong on a row, and it is what
      // the money is matched against. Only touched when the caller sent them, so
      // a form that does not offer these cannot blank them.
      if (d.paymentMethod !== undefined) patch.payment_method = String(d.paymentMethod || '').trim() || null;
      if (d.paymentReference !== undefined) patch.payment_reference = String(d.paymentReference || '').trim() || null;

      // The age group is a LABEL here, not a price. A registration saved before
      // the event had age groups carries none, and the desk needs to be able to
      // say "that one is a child" without deleting somebody who has paid.
      //
      // What they owe was agreed at registration and may already be settled, or
      // part-paid on a plan, so `amount` and `base_amount` are left exactly as
      // they are: a relabelling must never silently move money.
      if (d.priceTier !== undefined) {
        const wanted = String(d.priceTier || '').trim();
        if (!wanted) {
          patch.price_tier = null;
        } else {
          let tiers = [];
          try {
            const { data: tierRows } = await supabase
              .from('event_price_tiers').select('*').eq('event_id', reg.event_id).order('position');
            tiers = tierRows || [];
          } catch { /* this event has no age groups */ }
          const found = findTier({ event_price_tiers: tiers }, wanted);
          if (!found) {
            return NextResponse.json({
              success: false,
              errors: { priceTier: 'That is not one of this event’s age groups.' },
              message: 'Please pick one of this event’s age groups.',
            }, { status: 400 });
          }
          patch.price_tier = found.label;
        }
      }

      // Every row of a group carries the representative's name. Renaming the
      // representative's own row has to carry through to the rest, or the group
      // is left pointing at somebody who no longer exists under that name.
      const wasRep = !!reg.representative && normName(reg.representative) === normName(reg.attendee_name);
      if (wasRep) patch.representative = name;

      const { data: saved, error: editErr } = await supabase
        .from('event_registrations').update(patch).eq('id', id).select().single();
      if (editErr) throw editErr;

      if (wasRep && reg.group_ref) {
        await supabase.from('event_registrations')
          .update({ representative: name })
          .eq('group_ref', reg.group_ref)
          .neq('id', id);
      }

      // What actually changed, in the words the admin used - an audit line that
      // says "Edited a registration" is no use to whoever reads it next week.
      const changed = [];
      const say = (label, before, after) => {
        if (String(before ?? '') !== String(after ?? '')) changed.push(`${label}: "${before || '—'}" → "${after || '—'}"`);
      };
      say('Name', reg.attendee_name, patch.attendee_name);
      say('Church', reg.church_name, patch.church_name);
      say('Pastor', reg.church_pastor, patch.church_pastor);
      say('Contact', reg.attendee_mobile, patch.attendee_mobile);
      say('Email', reg.attendee_email, patch.attendee_email);
      if ('price_tier' in patch) say('Age group', reg.price_tier, patch.price_tier);
      if ('payment_method' in patch) say('Payment method', reg.payment_method, patch.payment_method);
      if ('payment_reference' in patch) say('Reference', reg.payment_reference, patch.payment_reference);

      await logAudit(actor, 'event_registration_edit', id, changed.length > 0
        ? `Edited ${name}'s registration — ${changed.join('; ')}`
        : `Opened ${name}'s registration and saved it unchanged`);
      cacheInvalidate(PENDING_ALERTS_KEY);
      return NextResponse.json({
        success: true,
        data: saved,
        changed: changed.length,
        message: changed.length > 0 ? 'Attendee details updated' : 'Nothing was changed',
      });
    }

    // An extra somebody forgot to avail - accommodation, most often - added to a
    // registration that already exists. No new slot: the same person owes more
    // than they did, and the money for it is usually being handed over at the
    // desk as this is recorded.
    if (action === 'add_addons') {
      const wantedIds = (Array.isArray(body.addonIds) ? body.addonIds : []).filter(Boolean);
      if (wantedIds.length === 0) {
        return NextResponse.json({ success: false, message: 'Tick at least one extra to add.' }, { status: 400 });
      }

      const { data: reg } = await supabase
        .from('event_registrations')
        .select('id, event_id, attendee_name, addons, amount, base_amount, price_tier, amount_paid, payment_plan, status, deleted_at, payment_method, payment_reference')
        .eq('id', id).single();
      if (!reg) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });
      if (reg.deleted_at) {
        return NextResponse.json({
          success: false,
          message: 'This registration is in the Recycle Bin. Restore it first, then add the extra.',
        }, { status: 400 });
      }
      if (reg.status === 'cancelled') {
        return NextResponse.json({
          success: false,
          message: 'This registration was cancelled — there is nothing to add an extra to.',
        }, { status: 400 });
      }

      // The prices come from the database, never from the form, so a tampered
      // request cannot add accommodation for nothing. The chosen ones are
      // snapshotted onto the registration the same way the entry forms do it,
      // so a later rename or reprice leaves this receipt reading correctly.
      const { data: addonRows } = await supabase
        .from('event_addons').select('*').eq('event_id', reg.event_id);
      // An extra added later is priced for the age group this person was booked
      // under, so a child's late accommodation costs a child's price.
      let regTier = null;
      if (reg.price_tier) {
        try {
          const { data: tierRows } = await supabase
            .from('event_price_tiers').select('*').eq('event_id', reg.event_id).order('position');
          regTier = findTier({ event_price_tiers: tierRows || [] }, reg.price_tier);
        } catch { /* no age groups - everyone pays the add-on's own fee */ }
      }
      const held = Array.isArray(reg.addons) ? reg.addons : [];
      const sameQuestion = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
      // An id on a registration can be stale (the extra was renamed or
      // re-created), so what they already hold is matched on the wording too -
      // otherwise somebody gets charged twice for the same bed.
      const alreadyHeld = (x) => held.some((h) => h.id === x.id || sameQuestion(h.question, x.question));
      const added = (addonRows || [])
        .filter((a) => wantedIds.includes(a.id) && !alreadyHeld(a))
        .map((a) => ({ id: a.id, question: a.question, fee: addonFeeFor(a, regTier) }));
      if (added.length === 0) {
        return NextResponse.json({
          success: false,
          message: 'Those extras are already on this registration — nothing was charged again.',
        }, { status: 400 });
      }

      const extra = added.reduce((sum, a) => sum + a.fee, 0);
      const owedAfter = (Number(reg.amount) || 0) + extra;
      // Staff at a desk have the money in hand; unticking it is how they say it
      // has not arrived yet.
      const collected = body.collectNow !== false;
      const method = String(body.paymentMethod || '').trim();
      const reference = String(body.paymentReference || '').trim();
      if (collected && extra > 0 && !method) {
        return NextResponse.json({ success: false, message: 'Choose how the extra was paid.' }, { status: 400 });
      }

      const patch = { addons: [...held, ...added], amount: owedAfter };
      let note = '';

      if (reg.payment_plan === 'flexible') {
        // A plan simply owes more now, and the money for the extra is one more
        // payment against it - recorded as its own row, with its own method and
        // reference, exactly like every other installment.
        let paid = Number(reg.amount_paid) || 0;
        if (collected && extra > 0) {
          const { error: payErr } = await supabase.from('event_registration_payments').insert({
            registration_id: id,
            amount: extra,
            paid_on: new Date().toISOString().slice(0, 10),
            method: method || null,
            reference: reference || null,
            note: `Extras added: ${added.map((a) => a.question).join(', ')}`,
            recorded_by: actor.id,
            recorded_by_name: `${actor.firstname} ${actor.lastname}`.trim(),
          });
          if (payErr) throw payErr;
          paid += extra;
        }
        patch.amount_paid = paid;
        // Fully settled means the slot is confirmed; anything short of it is
        // still a plan being paid down. The same rule the installments route
        // applies, so the two can never disagree about one registration.
        //
        // An extra that costs nothing moves no money, so it settles nothing and
        // unsettles nothing - the status the registration already has is still
        // the right one, and a ₱0 add must not push somebody onto a plan or off
        // one.
        if (extra > 0 && owedAfter > 0) {
          patch.status = paid >= owedAfter ? 'payment_verified' : 'installment';
          if (patch.status === 'payment_verified') {
            patch.verified_by = actor.id;
            patch.verified_at = new Date().toISOString();
          } else {
            patch.verified_by = null;
            patch.verified_at = null;
          }
        }
      } else {
        // Pay-in-full. The row carries one method and one reference for the
        // whole total, so the extra's payment details replace them - the form
        // arrives pre-filled with what is already there, so leaving them alone
        // changes nothing. What they were is written into the audit line below,
        // which is what makes the replacement safe to do.
        if (method && method !== reg.payment_method) note += `; method was "${reg.payment_method || '—'}"`;
        if (reference && reference !== reg.payment_reference) note += `; reference was "${reg.payment_reference || '—'}"`;
        if (method) patch.payment_method = method;
        if (reference) patch.payment_reference = reference;
        // Again, only money moves a status. An extra that costs nothing leaves
        // the registration exactly as it was.
        if (extra > 0 && collected) {
          // Staff took the money at the desk, so there is nobody left to check
          // it - the same rule as any other walk-in entry.
          patch.status = 'payment_verified';
          patch.verified_by = actor.id;
          patch.verified_at = new Date().toISOString();
        } else if (extra > 0) {
          // Fresh money is due and has not arrived, so the row goes back to
          // waiting for it rather than sitting there as verified.
          patch.status = 'payment_submitted';
          patch.verified_by = null;
          patch.verified_at = null;
        }
      }

      const { data: saved, error: addErr } = await supabase
        .from('event_registrations').update(patch).eq('id', id).select().single();
      if (addErr) throw addErr;

      cacheInvalidate(PENDING_ALERTS_KEY);
      await logAudit(actor, 'event_registration_addons', id,
        `Added ${added.map((a) => `${a.question} (+P${a.fee})`).join(', ')} to ${reg.attendee_name} — total now P${owedAfter}`
        + (collected
          ? ` (P${extra} collected${method ? ` by ${method}` : ''}${reference ? `, ref ${reference}` : ''})`
          : ` (P${extra} not yet collected)`)
        + note);

      return NextResponse.json({
        success: true,
        data: saved,
        added,
        extra,
        amount: owedAfter,
        message: collected
          ? `${added.map((a) => a.question).join(', ')} added — ₱${extra} collected, total now ₱${owedAfter}`
          : `${added.map((a) => a.question).join(', ')} added — ₱${extra} still to collect`,
      });
    }

    const update = {};
    if (status) {
      const valid = ['pending_payment', 'payment_submitted', 'pending_cash', 'installment', 'payment_verified', 'registered', 'cancelled'];
      if (!valid.includes(status)) return NextResponse.json({ success: false, message: 'Invalid status' }, { status: 400 });
      update.status = status;
      if (status === 'payment_verified' || status === 'registered') { update.verified_by = actor.id; update.verified_at = new Date().toISOString(); }
      // Going back to unverified must drop the old signature, or the row still
      // reads as "checked by X" while it waits to be checked again.
      if (status === 'payment_submitted' || status === 'pending_payment' || status === 'pending_cash' || status === 'installment') { update.verified_by = null; update.verified_at = null; }
    }
    if (attended === true) { update.attended = true; update.attended_at = new Date().toISOString(); update.attended_by = actor.id; }
    else if (attended === false) { update.attended = false; update.attended_at = null; update.attended_by = null; }

    const { data, error } = await supabase.from('event_registrations').update(update).eq('id', id).select().single();
    if (error) throw error;

    // Verifying/cancelling changes the pending set — clear the bell's cached feed.
    cacheInvalidate(PENDING_ALERTS_KEY);
    await logAudit(actor, attended !== undefined ? 'event_attendance_update' : 'event_registration_update', id, attended !== undefined ? `Set attendance to ${attended}` : `Set registration to ${status}`);
    return NextResponse.json({ success: true, data, message: attended !== undefined ? (attended ? 'Marked attended' : 'Attendance cleared') : 'Registration updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
