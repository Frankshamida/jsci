import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { SLOT_HOLDING_STATUSES } from '@/lib/eventSlots';
import { cacheInvalidate, cached } from '@/lib/serverCache';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';

// Only these roles may create/edit/delete events.
const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

// ---- Caching the list ----
//
// The public home page reads this endpoint on every visit, and the read is not
// cheap: the events themselves, their days and their add-ons, and then every
// slot-holding registration across all of them so the cards can say how many
// places are left. On a phone on mobile data that was the page's slowest
// moment, and it was the same answer every time.
//
// A short TTL fixes it without anybody having to think about invalidation: the
// list is stale for at most half a minute, which is well inside the time it
// takes somebody to read a poster and decide. `cached` also collapses
// concurrent misses, so twenty people opening a shared link at once cost one
// query rather than twenty.
//
// listVersion is the safety catch for the other direction. An Admin who edits
// an event must not be shown the old one, and waiting out a TTL to see your
// own edit is the sort of thing that makes people press Save twice - so every
// write bumps it and every cached key carries it, which retires the whole
// previous generation at once.
const LIST_TTL_MS = 30_000;
let listVersion = 0;
export const bumpEventsList = () => { listVersion += 1; };

// Server-side RBAC: verify the acting user is an Admin or Super Admin.
// Returns the user row on success, or null if unauthorized/unknown.
async function verifyEventManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabase.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    if (data && EVENT_MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* fall through */ }
  return null;
}

// Best-effort audit log entry (never blocks the main action)
async function logEventAudit(actor, action, eventId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'Unknown',
      action,
      resource: 'event',
      resource_id: eventId ? String(eventId) : null,
      details: details || null,
    });
  } catch { /* audit logging is non-fatal */ }
}

const FORBIDDEN = () => NextResponse.json({ success: false, message: 'Access denied. Only Admins and Super Admins can manage events.' }, { status: 403 });

// Parse a request as JSON or multipart form-data (with optional image file).
// Returns { fields, imageUrl } where imageUrl is set if an image file was uploaded.
async function uploadFile(file, folder) {
  const buffer = await file.arrayBuffer();
  const uploaded = await uploadBufferToCloudinary(buffer, {
    fileName: file.name || 'upload',
    mimeType: file.type || 'image/jpeg',
    folder,
    resourceType: 'image',
  });
  return uploaded.secureUrl;
}

async function parseEventRequest(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const fields = {};
    const merchImageFiles = {}; // index (string) -> File, from merchImage_<index> keys
    for (const [key, value] of form.entries()) {
      if (key === 'image' || key === 'gcashQr') continue;
      const merchMatch = /^merchImage_(\d+)$/.exec(key);
      if (merchMatch) {
        if (value && typeof value === 'object' && value.size > 0) merchImageFiles[merchMatch[1]] = value;
        continue;
      }
      fields[key] = value;
    }
    let imageUrl, gcashQrUrl;
    const banner = form.get('image');
    if (banner && typeof banner === 'object' && banner.size > 0) imageUrl = await uploadFile(banner, 'JSCI-System/events');
    const qr = form.get('gcashQr');
    if (qr && typeof qr === 'object' && qr.size > 0) gcashQrUrl = await uploadFile(qr, 'JSCI-System/event-payments');

    // Upload any new merch item images, keyed by their item's index
    const merchImageUrls = {};
    for (const [index, file] of Object.entries(merchImageFiles)) {
      merchImageUrls[index] = await uploadFile(file, 'JSCI-System/event-merch');
    }

    return { fields, imageUrl, gcashQrUrl, merchImageUrls };
  }
  const body = await request.json();
  return { fields: body, imageUrl: undefined, gcashQrUrl: undefined, merchImageUrls: {} };
}

// Map the incoming pricing/registration fields to DB columns (only when provided)
function mapEventConfig(updates, target, gcashQrUrl) {
  const bool = (v) => v === true || v === 'true';
  const num = (v) => (v === '' || v == null ? null : Number(v));
  if (updates.hasFee !== undefined) target.has_fee = bool(updates.hasFee);
  if (updates.registrationFee !== undefined) target.registration_fee = num(updates.registrationFee) || 0;
  if (updates.allowOnsitePayment !== undefined) target.allow_onsite_payment = bool(updates.allowOnsitePayment);
  if (updates.onsitePrice !== undefined) target.onsite_price = num(updates.onsitePrice);
  if (updates.earlyBirdPrice !== undefined) target.early_bird_price = num(updates.earlyBirdPrice);
  if (updates.earlyBirdDeadline !== undefined) target.early_bird_deadline = updates.earlyBirdDeadline || null;
  if (updates.paymentDeadline !== undefined) target.payment_deadline = updates.paymentDeadline || null;
  if (updates.refundPolicy !== undefined) target.refund_policy = updates.refundPolicy || null;
  if (updates.paymentInstructions !== undefined) target.payment_instructions = updates.paymentInstructions || null;
  if (updates.paymentMethods !== undefined) {
    target.payment_methods = Array.isArray(updates.paymentMethods)
      ? updates.paymentMethods
      : String(updates.paymentMethods || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  // Channels picked from the shared "Mode of Payment" page. Only the ids are
  // stored — name / account / logo are read live from payment_methods, so
  // correcting an account number there fixes every event at once.
  if (updates.paymentMethodIds !== undefined) {
    const arr = Array.isArray(updates.paymentMethodIds)
      ? updates.paymentMethodIds
      : String(updates.paymentMethodIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    target.payment_method_ids = arr.length ? arr : null;
  }
  if (updates.gcashName !== undefined) target.gcash_name = updates.gcashName || null;
  if (updates.gcashNumber !== undefined) target.gcash_number = updates.gcashNumber || null;
  if (gcashQrUrl) target.gcash_qr_url = gcashQrUrl;
  else if (updates.gcashQrUrl !== undefined) target.gcash_qr_url = updates.gcashQrUrl || null;
  if (updates.bankName !== undefined) target.bank_name = updates.bankName || null;
  if (updates.bankAccountName !== undefined) target.bank_account_name = updates.bankAccountName || null;
  if (updates.bankAccountNumber !== undefined) target.bank_account_number = updates.bankAccountNumber || null;
  // Who a registrant calls about their own registration.
  if (updates.contactNumber !== undefined) target.contact_number = updates.contactNumber || null;
  if (updates.contactName !== undefined) target.contact_name = updates.contactName || null;
  if (updates.registrationRequired !== undefined) target.registration_required = bool(updates.registrationRequired);
  if (updates.maxParticipants !== undefined) target.max_participants = num(updates.maxParticipants);
  if (updates.registrationStartDate !== undefined) target.registration_start_date = updates.registrationStartDate || null;
  if (updates.registrationDeadline !== undefined) target.registration_deadline = updates.registrationDeadline || null;
  // Audience & visibility
  if (updates.allowedRoles !== undefined) {
    const arr = Array.isArray(updates.allowedRoles)
      ? updates.allowedRoles
      : String(updates.allowedRoles || '').split(',').map(s => s.trim()).filter(Boolean);
    target.allowed_roles = arr.length ? arr : null; // null = all roles
  }
  if (updates.isPublished !== undefined) target.is_published = bool(updates.isPublished);
  // Map location
  if (updates.latitude !== undefined) target.latitude = num(updates.latitude);
  if (updates.longitude !== undefined) target.longitude = num(updates.longitude);
  if (updates.locCountry !== undefined) target.loc_country = updates.locCountry || null;
  if (updates.locRegion !== undefined) target.loc_region = updates.locRegion || null;
  if (updates.locProvince !== undefined) target.loc_province = updates.locProvince || null;
  if (updates.locCity !== undefined) target.loc_city = updates.locCity || null;
  if (updates.locBarangay !== undefined) target.loc_barangay = updates.locBarangay || null;
  return target;
}

// Build the final merch_items array from the client's JSON metadata (name + whether
// it already had an image) plus any newly-uploaded merch image URLs from this request.
// Returns undefined when merchItemsMeta wasn't sent at all, so callers can tell
// "no merch info in this request" apart from "merch was cleared to an empty list".
function buildMerchItems(fields, merchImageUrls) {
  if (fields.merchItemsMeta === undefined) return undefined;
  let meta;
  try { meta = JSON.parse(fields.merchItemsMeta || '[]'); } catch { meta = []; }
  if (!Array.isArray(meta)) return [];
  return meta
    .map((item, i) => ({
      name: (item?.name || '').trim(),
      image_url: merchImageUrls?.[String(i)] || item?.existingImageUrl || null,
    }))
    .filter((item) => item.name || item.image_url);
}

// ---- Per-day schedules (event_days) --------------------------------------
// The client sends `days` as a JSON array of
//   { dayNumber, startsAt, endsAt, label }
// with wall-clock datetimes ("2026-10-02T09:00"). Returns { eventDate, endDate }
// derived from the rows so events.event_date / end_date stay the authoritative
// overall span - every existing listing, sort and "upcoming" filter reads those
// two columns.

// A session datetime as the admin typed it: "2026-10-02T09:00" -> the literal
// string "2026-10-02T09:00:00". NEVER via `new Date(...).toISOString()` - that
// reads the string as an instant in the writer's zone and re-emits it in UTC,
// so a 9:00 AM session posted from Manila landed in the column as 01:00 and the
// public page (which reads these as wall-clock, like events.event_date) showed
// "1:00 AM". Every reader in this app treats these columns as wall-clock, so the
// writer must store wall-clock too.
function wallClock(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
}
// Sortable stamp for a wall-clock string. The strings are fixed-width and
// zero-padded, so a plain string compare already orders them correctly - but a
// number keeps Math.min/Math.max readable at the call sites.
function wallMs(value) {
  const w = wallClock(value);
  if (!w) return NaN;
  return Number(w.replace(/\D/g, ''));
}

function parseEventDays(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const rows = [];
  parsed.forEach((d) => {
    const startsAt = d ? wallClock(d.startsAt) : null;
    if (!startsAt) return;   // skip incomplete days
    let endsAt = d.endsAt ? wallClock(d.endsAt) : null;
    // guard the CHECK constraint rather than letting the insert 500
    if (endsAt && endsAt < startsAt) endsAt = null;
    rows.push({
      day_number: Number(d.dayNumber) || rows.length + 1,
      starts_at: startsAt,
      ends_at: endsAt,
      label: d.label ? String(d.label).slice(0, 200) : null,
    });
  });
  return rows;
}

// Overall span across the day rows, in the same wall-clock form. Falls back to
// nulls for an empty set.
function spanFromDays(rows) {
  if (!rows || rows.length === 0) return { eventDate: null, endDate: null };
  const starts = rows.map((r) => r.starts_at).filter(Boolean);
  const ends = rows.map((r) => r.ends_at || r.starts_at).filter(Boolean);
  if (starts.length === 0) return { eventDate: null, endDate: null };
  const pick = (list, cmp) => list.reduce((best, v) => (cmp(wallMs(v), wallMs(best)) ? v : best));
  return {
    eventDate: pick(starts, (a, b) => a < b),
    endDate: pick(ends, (a, b) => a > b),
  };
}

// Replace an event's day rows wholesale. Deleting first keeps the set exactly
// in sync when the admin shortens a 5-day event back to 2 - an upsert alone
// would leave days 3-5 orphaned and still showing on the public page.
async function syncEventDays(eventId, rows) {
  await supabase.from('event_days').delete().eq('event_id', eventId);
  if (!rows || rows.length === 0) return;
  const payload = rows.map((r, i) => ({ ...r, day_number: i + 1, event_id: eventId }));
  const { error } = await supabase.from('event_days').insert(payload);
  if (error) throw error;
}

// ---- Paid add-on questions (event_addons) ---------------------------------
// The client sends `addons` as a JSON array of
//   { question, description, fee, isRequired }
// Each one is a yes/no question that adds `fee` to an attendee's total when
// they tick it. events.registration_fee stays the BASE price.
function parseEventAddons(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const rows = [];
  parsed.forEach((a) => {
    const question = (a && a.question ? String(a.question) : '').trim();
    if (!question) return;                       // skip half-typed rows
    const fee = Number(a.fee);
    rows.push({
      position: rows.length + 1,
      question: question.slice(0, 300),
      description: a.description ? String(a.description).slice(0, 500) : null,
      details: a.details ? String(a.details).slice(0, 2000) : null,
      fee: Number.isFinite(fee) && fee > 0 ? fee : 0,
      is_required: a.isRequired === true || a.isRequired === 'true',
    });
  });
  return rows;
}

// Replace an event's add-ons wholesale, for the same reason as the day rows:
// an upsert would leave a deleted question still showing on the public page.
async function syncEventAddons(eventId, rows) {
  await supabase.from('event_addons').delete().eq('event_id', eventId);
  if (!rows || rows.length === 0) return;
  const payload = rows.map((r, i) => ({ ...r, position: i + 1, event_id: eventId }));
  const { error } = await supabase.from('event_addons').insert(payload);
  if (error) throw error;
}

// GET - Fetch events
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 50;
    const upcoming = searchParams.get('upcoming') === 'true';
    // Public/member views pass published=true to hide drafts. Admin omits it.
    const publishedOnly = searchParams.get('published') === 'true';

    const key = `events:list:v${listVersion}:${limit}:${upcoming ? 'u' : 'a'}:${publishedOnly ? 'p' : 'all'}`;
    const events = await cached(key, LIST_TTL_MS, async () => {
      let query = supabase.from('events').select('*, event_days(*), event_addons(*)').eq('is_active', true).order('event_date', { ascending: true }).limit(limit);
      if (upcoming) {
        query = query.gte('event_date', new Date().toISOString());
      }
      if (publishedOnly) {
        query = query.eq('is_published', true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    });

    // Shallow copies, because `events` above came out of the cache and is
    // handed to every request that hits the same key. The counts and the sorted
    // nested rows below are written onto each event, and writing them onto the
    // cached objects would leave one request's answer sitting in the next
    // request's data.
    const out = events.map((e) => ({ ...e }));

    // Attach a live count of the registrations actually holding a seat, so the
    // UI can show remaining slots. Paid and on-a-plan hold one; a payment
    // nobody has checked yet does not. See lib/eventSlots.
    try {
      const ids = out.map((e) => e.id);
      if (ids.length > 0) {
        // Cached on its own key, and for half as long as the list. This is the
        // half that actually moves - somebody registering changes it - and it
        // is also the expensive half, since it reads a row per held seat
        // across every event in the list.
        const regs = await cached(
          `events:counts:v${listVersion}:${ids.join(',')}`,
          LIST_TTL_MS / 2,
          async () => {
            const { data } = await supabase
              .from('event_registrations')
              .select('event_id, status')
              .in('event_id', ids)
              .in('status', SLOT_HOLDING_STATUSES)
              // A registration in the Recycle Bin must not go on holding a slot.
              .is('deleted_at', null);
            return data || [];
          },
        );

        const counts = {};
        // One row, one seat - a registration on a plan is listed under both
        // Registrations and Flexible Installment, but it is the same person.
        // The split is carried alongside so the figure can explain itself.
        regs.forEach((r) => {
          const c = counts[r.event_id] || (counts[r.event_id] = { total: 0, paid: 0, installment: 0 });
          c.total += 1;
          if (r.status === 'installment') c.installment += 1; else c.paid += 1;
        });
        out.forEach((e) => {
          const c = counts[e.id] || { total: 0, paid: 0, installment: 0 };
          e.registered_count = c.total;
          e.paid_count = c.paid;
          e.installment_count = c.installment;
          e.slots_left = e.max_participants ? Math.max(0, e.max_participants - e.registered_count) : null;
        });
      }
    } catch { /* count is best-effort */ }

    // Supabase returns the nested rows unordered; Day 1 must come first.
    // Sorted onto a copy of each array for the same reason as the events above.
    out.forEach((e) => {
      if (Array.isArray(e.event_days)) {
        e.event_days = [...e.event_days].sort((a, b) => (a.day_number || 0) - (b.day_number || 0));
      }
      if (Array.isArray(e.event_addons)) {
        e.event_addons = [...e.event_addons].sort((a, b) => (a.position || 0) - (b.position || 0));
      }
    });

    // The published list is the same answer for everybody, so the browser and
    // any CDN in front of us are allowed to keep it for a moment - which is
    // what stops a second component asking for the same list going out to the
    // network again. The admin list is per-request by nature and is never
    // stored: a draft must not sit in a shared cache.
    return NextResponse.json({ success: true, data: out }, {
      headers: publishedOnly
        ? { 'Cache-Control': 'public, max-age=20, s-maxage=30, stale-while-revalidate=120' }
        : { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create event (Pastor, Admin, Super Admin)
export async function POST(request) {
  try {
    const { fields, imageUrl: uploadedUrl, gcashQrUrl, merchImageUrls } = await parseEventRequest(request);
    const { title, description, eventDate, endDate, location, imageUrl, createdBy } = fields;
    const finalImageUrl = uploadedUrl || imageUrl || null;

    // RBAC: only Admin/Super Admin (the createdBy is the acting user here)
    const actor = await verifyEventManager(createdBy);
    if (!actor) return FORBIDDEN();

    if (!title) {
      return NextResponse.json({ success: false, message: 'Title is required' }, { status: 400 });
    }
    // A published event needs a real date; a draft can be created from just the
    // basics (Save Draft on the client always sends a placeholder date regardless,
    // but this stays defensive in case a draft is ever posted without one).
    const isDraft = fields.isPublished === false || fields.isPublished === 'false';
    if (!isDraft && !eventDate) {
      return NextResponse.json({ success: false, message: 'Event date is required to publish' }, { status: 400 });
    }

    // A per-day schedule, when present, is the source of truth for the span.
    const dayRows = parseEventDays(fields.days);
    const span = spanFromDays(dayRows);
    const addonRows = parseEventAddons(fields.addons);

    const insertData = mapEventConfig(fields, {
      title, description,
      event_date: span.eventDate || eventDate || new Date().toISOString(),
      end_date: span.endDate || endDate || null,
      location, image_url: finalImageUrl, created_by: createdBy,
    }, gcashQrUrl);
    const merchItems = buildMerchItems(fields, merchImageUrls);
    if (merchItems !== undefined) insertData.merch_items = merchItems;

    const { data, error } = await supabase.from('events').insert(insertData).select().single();

    if (error) throw error;
    if (dayRows && dayRows.length > 0) await syncEventDays(data.id, dayRows);
    if (addonRows && addonRows.length > 0) await syncEventAddons(data.id, addonRows);
    // Retires every cached list - see bumpEventsList. AFTER the write, not
    // before: a read arriving mid-write would otherwise re-cache the old rows
    // under the new version and outlive the change by a full TTL.
    bumpEventsList();
    await logEventAudit(actor, 'create_event', data.id, `Created event "${title}"`);
    return NextResponse.json({ success: true, data, message: 'Event created successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update event
export async function PUT(request) {
  try {
    const { fields, imageUrl: uploadedUrl, gcashQrUrl, merchImageUrls } = await parseEventRequest(request);
    const { id, actorId, ...updates } = fields;

    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    // RBAC: only Admin/Super Admin may edit
    const actor = await verifyEventManager(actorId);
    if (!actor) return FORBIDDEN();

    const dayRows = parseEventDays(updates.days);
    const span = spanFromDays(dayRows);
    const addonRows = parseEventAddons(updates.addons);

    const updateData = {};
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.eventDate) updateData.event_date = updates.eventDate;
    if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
    // day rows win over the plain start/end fields when both are sent
    if (span.eventDate) updateData.event_date = span.eventDate;
    if (span.endDate) updateData.end_date = span.endDate;
    if (updates.location !== undefined) updateData.location = updates.location;
    if (uploadedUrl) updateData.image_url = uploadedUrl;
    else if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
    mapEventConfig(updates, updateData, gcashQrUrl);
    const merchItems = buildMerchItems(updates, merchImageUrls);
    if (merchItems !== undefined) updateData.merch_items = merchItems;

    const { data, error } = await supabase.from('events').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    // null (field absent) leaves existing days alone; [] clears them.
    if (dayRows !== null) await syncEventDays(id, dayRows);
    if (addonRows !== null) await syncEventAddons(id, addonRows);

    const isArchive = updates.isActive === false || updates.isActive === 'false';
    // Retires every cached list - see bumpEventsList. AFTER the write, not
    // before: a read arriving mid-write would otherwise re-cache the old rows
    // under the new version and outlive the change by a full TTL.
    bumpEventsList();
    await logEventAudit(actor, isArchive ? 'archive_event' : 'update_event', id, isArchive ? 'Archived event' : `Updated event "${data.title}"`);
    return NextResponse.json({ success: true, data, message: 'Event updated successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Delete event
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const actorId = searchParams.get('actorId');
    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    // RBAC: only Admin/Super Admin may delete
    const actor = await verifyEventManager(actorId);
    if (!actor) return FORBIDDEN();

    const { error } = await supabase.from('events').update({ is_active: false }).eq('id', id);
    if (error) throw error;

    // The admin bell feeds off a cached pending-registration list; a deleted
    // event's rows must drop out of it now, not up to a minute from now.
    cacheInvalidate('events:pending-registrations');

    await logEventAudit(actor, 'delete_event', id, 'Deleted event');
    // Retires every cached list - see bumpEventsList.
    bumpEventsList();
    return NextResponse.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
