import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { cached, cacheInvalidate } from '@/lib/serverCache';

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

async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabase.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* ignore */ }
  return null;
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
          .select('id, attendee_name, status, created_at, event:events(id, title)')
          .in('status', ['payment_submitted', 'pending_payment', 'registered'])
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return rows || [];
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

    if (searchParams.get('churches')) {
      const q = (searchParams.get('q') || '').trim().toLowerCase();
      const { data: rows } = await supabase
        .from('event_registrations')
        .select('church_name')
        .not('church_name', 'is', null)
        .neq('status', 'cancelled')
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

    // "My Registrations": all of a user's registrations joined with the event
    if (!eventId && userId) {
      const { data, error } = await supabase
        .from('event_registrations')
        .select('*, event:events(id, title, description, image_url, event_date, end_date, location, loc_city, loc_province, latitude, longitude, has_fee, registration_fee)')
        .eq('user_id', userId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return NextResponse.json({ success: true, data: data || [] });
    }

    let query = supabase.from('event_registrations').select('*').eq('event_id', eventId).order('created_at', { ascending: false });
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
          mimeType: file.type || 'image/jpeg',
          folder: 'JSCI-System/event-payments',
          resourceType: 'image',
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

    // Role restriction: if allowed_roles is set, the user's role must be in it
    if (Array.isArray(event.allowed_roles) && event.allowed_roles.length > 0) {
      let role = null;
      if (userId) {
        const { data: u } = await supabase.from('users').select('role').eq('id', userId).single();
        role = u?.role || null;
      }
      if (!role || !event.allowed_roles.includes(role)) {
        return NextResponse.json({ success: false, message: 'This event is only open to specific roles.' }, { status: 403 });
      }
    }

    // Deadline check
    if (event.registration_deadline && new Date() > new Date(event.registration_deadline)) {
      return NextResponse.json({ success: false, message: 'Registration is closed for this event' }, { status: 400 });
    }

    // Capacity check (count non-cancelled registrations)
    if (event.max_participants) {
      const { count } = await supabase.from('event_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).neq('status', 'cancelled');
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

    // Prevent duplicate registration
    if (userId) {
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
    // An installment plan starts owing money whatever was handed over today, so
    // it stays "submitted" until the payments add up to the total.
    if (fields.paymentPlan === 'flexible' && dueNow > 0) status = 'payment_submitted';

    // One id shared by every row of the same group, so the admin can see the
    // five people who arrived on one payment as one booking.
    const groupRef = isBulk ? `grp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : null;

    // How this registration came to be, and whose name is on having made it:
    //   bulk       -> a representative registering a group
    //   admin      -> staff entering a walk-in on someone's behalf
    //   individual -> the attendee themselves
    // The TYPE is always about how many people this covers - one, or a group.
    // WHO entered it is a separate question, answered by added_by_role.
    const addedByAdmin = !!fields.addedByAdmin;
    const registrationType = isBulk ? 'bulk' : 'individual';
    const addedByRole = addedByAdmin
      ? (String(fields.addedByRole || 'Admin').trim() || 'Admin')   // 'Admin' | 'Super Admin'
      : (isBulk ? 'Representative' : 'Attendee');
    const addedByName = (() => {
      if (addedByAdmin) return titleCaseName(fields.addedByName) || null;
      if (isBulk) return titleCaseName(fields.representative || attendeeName) || null;
      return attendeeName || null;
    })();

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
    };

    const rows = isBulk
      ? priced.map((a) => ({
          ...shared,
          user_id: null,
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
    if (rows.length > 0) {
      const { data, error } = await supabase.from('event_registrations').insert(rows).select();
      if (error) {
        // These columns only exist once the bulk migration has been run. Without
        // them a registration still saves - the rows are simply not labelled.
        if (/group_ref|group_size|representative|registration_type|added_by|added_by_role|payment_plan|column/i.test(error.message || '')) {
          const bare = rows.map(({
            group_ref: _g, group_size: _s, representative: _r,
            registration_type: _t, added_by: _a, added_by_role: _ar, payment_plan: _p, ...rest
          }) => rest);
          const retry = await supabase.from('event_registrations').insert(bare).select();
          if (retry.error) throw retry.error;
          inserted = retry.data;
          // Saved, but the labelling was dropped on the floor. The caller is told
          // so this does not look like the feature quietly not working.
          columnWarning = 'Saved, but this database is missing the newer registration columns '
            + '(registration type, added by, payment plan). Run supabase/migrations/event_bulk_registration.sql '
            + 'and event_flexible_payment.sql to record them.';
        } else throw error;
      } else inserted = data;
    }

    // The representative may be availing an extra on a slot they already hold -
    // no new seat, just more owed on the registration they have. Their row is
    // updated and put back for verification, since fresh money is due.
    if (isBulk && topUpIds.length > 0) {
      const repName = normName(fields.representative || attendeeName);
      const { data: candidates } = await supabase
        .from('event_registrations')
        .select('id, attendee_name, addons, amount')
        .eq('event_id', eventId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(5000);
      const target = (candidates || []).find((r) => normName(r.attendee_name) === repName);
      if (target) {
        const held = Array.isArray(target.addons) ? target.addons : [];
        const heldIds = new Set(held.map((a) => a.id));
        const added = (addonRows || [])
          .filter((a) => topUpIds.includes(a.id) && !heldIds.has(a.id))
          .map((a) => ({ id: a.id, question: a.question, fee: Number(a.fee) || 0 }));
        if (added.length > 0) {
          const extra = added.reduce((sum, a) => sum + a.fee, 0);
          const patch = {
            addons: [...held, ...added],
            amount: (Number(target.amount) || 0) + extra,
            status: 'payment_submitted',
            verified_by: null,
            verified_at: null,
          };
          if (paymentReference) patch.payment_reference = paymentReference;
          if (proofUrl) patch.payment_proof_url = proofUrl;
          await supabase.from('event_registrations').update(patch).eq('id', target.id);
          await logAudit(null, 'event_registration_update', target.id,
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
        await supabase.from('event_registrations')
          .update({ amount_paid: firstPayment })
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
          ? 'Your extras have been submitted for verification.'
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

// PUT /api/events/registrations  { id, actorId, status }            -> admin verifies/updates a registration
//                                { id, actorId, attended: true|false } -> admin marks/clears attendance (QR check-in)
// DELETE /api/events/registrations?id=..&userId=..  -> a member cancels their OWN registration
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
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
    const { id, actorId, status, attended } = await request.json();
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });
    if (!status && attended === undefined) return NextResponse.json({ success: false, message: 'status or attended required' }, { status: 400 });

    const actor = await verifyEventManager(actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const update = {};
    if (status) {
      const valid = ['pending_payment', 'payment_submitted', 'payment_verified', 'registered', 'cancelled'];
      if (!valid.includes(status)) return NextResponse.json({ success: false, message: 'Invalid status' }, { status: 400 });
      update.status = status;
      if (status === 'payment_verified' || status === 'registered') { update.verified_by = actor.id; update.verified_at = new Date().toISOString(); }
      // Going back to unverified must drop the old signature, or the row still
      // reads as "checked by X" while it waits to be checked again.
      if (status === 'payment_submitted' || status === 'pending_payment') { update.verified_by = null; update.verified_at = null; }
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
