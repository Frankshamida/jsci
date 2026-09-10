import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { cached, cacheInvalidate } from '@/lib/serverCache';
import { SLOT_HOLDING_STATUSES } from '@/lib/eventSlots';
import { findEventActor, canWorkEvent, actorRoleLabel, staffDeniedMessage } from '@/lib/eventCommittee';

// Churches are typed by hand, so the same church arrives as "joyful sound church"
// and "Joyful Sound Church". Stored in Title Case so the list stays one entry.
const CHURCH_MINOR_WORDS = new Set(['of', 'the', 'and', 'in', 'for', 'a', 'an', 'at', 'on', 'to']);
function titleCaseChurch(name) {
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
  'church_name', 'church_pastor', 'base_amount', 'addons',
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
          .in('status', ['payment_submitted', 'pending_payment', 'registered'])
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
      const withEvent = '*, event:events(id, title, description, image_url, event_date, end_date, location, loc_city, loc_province, latitude, longitude, has_fee, registration_fee)';
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
      .select('id, title, has_fee, registration_fee, early_bird_price, early_bird_deadline, max_participants, registration_deadline, is_active, is_published, allowed_roles')
      .eq('id', eventId).single();
    if (evErr || !event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    if (event.is_active === false) return NextResponse.json({ success: false, message: 'This event is no longer available' }, { status: 400 });
    if (event.is_published === false) return NextResponse.json({ success: false, message: 'This event is not open for registration yet' }, { status: 400 });

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

    // Determine amount (early bird if applicable) & status
    let baseAmount = 0;
    let status = 'registered';
    if (event.has_fee) {
      baseAmount = Number(event.registration_fee) || 0;
      if (event.early_bird_price != null && event.early_bird_deadline && new Date() <= new Date(event.early_bird_deadline)) {
        baseAmount = Number(event.early_bird_price);
      }
    }

    // Paid add-ons. The client sends only the IDs it ticked; the prices are read
    // back from the DB here so a tampered form can never lower the total. The
    // chosen ones are snapshotted onto the registration so the receipt still
    // reads correctly if the admin later renames or reprices a question.
    const { data: addonRows } = await supabase
      .from('event_addons').select('id, question, fee, is_required').eq('event_id', eventId);
    // Required add-ons are always charged, whether or not they were sent.
    const pickAddons = (ids) => (addonRows || [])
      .filter((a) => a.is_required || (ids || []).includes(a.id))
      .map((a) => ({ id: a.id, question: a.question, fee: Number(a.fee) || 0 }));

    let singleIds = fields.addonIds;
    if (typeof singleIds === 'string') {
      try { singleIds = JSON.parse(singleIds); } catch { singleIds = singleIds.split(',').map((v) => v.trim()); }
    }
    singleIds = Array.isArray(singleIds) ? singleIds.filter(Boolean) : [];

    const chosenAddons = pickAddons(singleIds);
    const addonTotal = chosenAddons.reduce((sum, a) => sum + a.fee, 0);
    const amount = baseAmount + addonTotal;

    // In a group the extras are ticked per person, so everyone is priced on their
    // own line and the payment covers the sum of them.
    const priced = people.map((a) => {
      const addons = pickAddons(a.addonIds);
      return {
        ...a,
        addons,
        amount: baseAmount + addons.reduce((sum, x) => sum + x.fee, 0),
      };
    });
    const groupTotal = priced.reduce((sum, a) => sum + a.amount, 0);

    // An otherwise-free event still has to be paid for once a paid add-on is picked.
    // A group's bill is everyone on the roster plus anything the representative
    // is availing on the slot they already hold.
    const topUpTotal = (addonRows || [])
      .filter((a) => topUpIds.includes(a.id))
      .reduce((sum, a) => sum + (Number(a.fee) || 0), 0);
    const dueNow = isBulk ? groupTotal + topUpTotal : amount;
    if (dueNow > 0) status = (proofUrl || paymentReference) ? 'payment_submitted' : 'pending_payment';

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
      attendee_mobile: attendeeMobile || null,
      // who to call about this booking - the person who filled in the form
      representative: isBulk ? (titleCaseName(fields.representative || attendeeName) || null) : null,
      church_name: titleCaseChurch(fields.churchName) || null,
      // stored as "Ptr. Juan Dela Cruz" however it was typed
      church_pastor: (() => {
        const bare = titleCaseName(String(fields.churchPastor || '').replace(/^ptr\.?\s*/i, ''));
        return bare ? `Ptr. ${bare}` : null;
      })(),
      base_amount: baseAmount,
      registration_type: registrationType,
      added_by: addedByName,
      added_by_role: addedByRole,
      // 'flexible' means this will be settled over several payments, recorded
      // against the registration in event_registration_payments.
      payment_plan: fields.paymentPlan === 'flexible' ? 'flexible' : 'full',
      payment_method: paymentMethod || null,
      payment_reference: paymentReference || null,
      payment_proof_url: proofUrl,
      status,
      ...(status === 'payment_verified' && adminActor
        ? { verified_by: adminActor.id, verified_at: new Date().toISOString() }
        : {}),
    };

    // Whose slot is whose in a group. Every row is stamped with the account
    // that booked it - that is what lets the representative see the whole
    // group in My Registrations - but only the representative's own row is
    // stamped as BEING theirs, because only that one is a seat they occupy.
    const repKey = normName(fields.representative || attendeeName);
    const rows = isBulk
      ? priced.map((a) => ({
          ...shared,
          user_id: (userId && (a.isRep || normName(`${a.firstName} ${a.lastName}`) === repKey)) ? userId : null,
          registered_by_user_id: userId || null,
          attendee_firstname: a.firstName || null,
          attendee_lastname: a.lastName || null,
          attendee_name: `${a.firstName} ${a.lastName}`.trim(),
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
          } else {
            // A guest adding an extra owes fresh money that has to be checked.
            patch.status = 'payment_submitted';
            patch.verified_by = null;
            patch.verified_at = null;
          }
          if (paymentReference) patch.payment_reference = paymentReference;
          if (proofUrl) patch.payment_proof_url = proofUrl;
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
//   that registration's event. The two bin actions below stay Admin-only.
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
    const { id, ids, actorId, status, attended, action, reason } = await request.json();
    if (!id && !(Array.isArray(ids) && ids.length > 0)) {
      return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    }
    if (!status && attended === undefined && !action) return NextResponse.json({ success: false, message: 'status, attended or action required' }, { status: 400 });

    // Two different gates, because these are two different kinds of change.
    // Binning a registration destroys work and is an Admin's call; checking
    // someone in at the door and confirming the money they handed over is the
    // committee's whole job. So the bin keeps the Admin-only check, and
    // everything else asks whether this person may work THIS event.
    const binning = action === 'soft_delete' || action === 'restore';
    let actor;
    if (binning) {
      actor = await verifyEventManager(actorId);
      if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
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

    const update = {};
    if (status) {
      const valid = ['pending_payment', 'payment_submitted', 'installment', 'payment_verified', 'registered', 'cancelled'];
      if (!valid.includes(status)) return NextResponse.json({ success: false, message: 'Invalid status' }, { status: 400 });
      update.status = status;
      if (status === 'payment_verified' || status === 'registered') { update.verified_by = actor.id; update.verified_at = new Date().toISOString(); }
      // Going back to unverified must drop the old signature, or the row still
      // reads as "checked by X" while it waits to be checked again.
      if (status === 'payment_submitted' || status === 'pending_payment' || status === 'installment') { update.verified_by = null; update.verified_at = null; }
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
