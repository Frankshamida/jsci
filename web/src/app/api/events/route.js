import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';

// Only these roles may create/edit/delete events.
const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

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
    for (const [key, value] of form.entries()) {
      if (key !== 'image' && key !== 'gcashQr') fields[key] = value;
    }
    let imageUrl, gcashQrUrl;
    const banner = form.get('image');
    if (banner && typeof banner === 'object' && banner.size > 0) imageUrl = await uploadFile(banner, 'JSCI-System/events');
    const qr = form.get('gcashQr');
    if (qr && typeof qr === 'object' && qr.size > 0) gcashQrUrl = await uploadFile(qr, 'JSCI-System/event-payments');
    return { fields, imageUrl, gcashQrUrl };
  }
  const body = await request.json();
  return { fields: body, imageUrl: undefined, gcashQrUrl: undefined };
}

// Map the incoming pricing/registration fields to DB columns (only when provided)
function mapEventConfig(updates, target, gcashQrUrl) {
  const bool = (v) => v === true || v === 'true';
  const num = (v) => (v === '' || v == null ? null : Number(v));
  if (updates.hasFee !== undefined) target.has_fee = bool(updates.hasFee);
  if (updates.registrationFee !== undefined) target.registration_fee = num(updates.registrationFee) || 0;
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
  if (updates.gcashName !== undefined) target.gcash_name = updates.gcashName || null;
  if (updates.gcashNumber !== undefined) target.gcash_number = updates.gcashNumber || null;
  if (gcashQrUrl) target.gcash_qr_url = gcashQrUrl;
  else if (updates.gcashQrUrl !== undefined) target.gcash_qr_url = updates.gcashQrUrl || null;
  if (updates.bankName !== undefined) target.bank_name = updates.bankName || null;
  if (updates.bankAccountName !== undefined) target.bank_account_name = updates.bankAccountName || null;
  if (updates.bankAccountNumber !== undefined) target.bank_account_number = updates.bankAccountNumber || null;
  if (updates.registrationRequired !== undefined) target.registration_required = bool(updates.registrationRequired);
  if (updates.maxParticipants !== undefined) target.max_participants = num(updates.maxParticipants);
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

// GET - Fetch events
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 50;
    const upcoming = searchParams.get('upcoming') === 'true';
    // Public/member views pass published=true to hide drafts. Admin omits it.
    const publishedOnly = searchParams.get('published') === 'true';

    let query = supabase.from('events').select('*').eq('is_active', true).order('event_date', { ascending: true }).limit(limit);
    if (upcoming) {
      query = query.gte('event_date', new Date().toISOString());
    }
    if (publishedOnly) {
      query = query.eq('is_published', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create event (Pastor, Admin, Super Admin)
export async function POST(request) {
  try {
    const { fields, imageUrl: uploadedUrl, gcashQrUrl } = await parseEventRequest(request);
    const { title, description, eventDate, endDate, location, imageUrl, createdBy } = fields;
    const finalImageUrl = uploadedUrl || imageUrl || null;

    // RBAC: only Admin/Super Admin (the createdBy is the acting user here)
    const actor = await verifyEventManager(createdBy);
    if (!actor) return FORBIDDEN();

    if (!title || !eventDate) {
      return NextResponse.json({ success: false, message: 'Title and event date are required' }, { status: 400 });
    }

    const insertData = mapEventConfig(fields, {
      title, description, event_date: eventDate, end_date: endDate || null,
      location, image_url: finalImageUrl, created_by: createdBy,
    }, gcashQrUrl);

    const { data, error } = await supabase.from('events').insert(insertData).select().single();

    if (error) throw error;
    await logEventAudit(actor, 'create_event', data.id, `Created event "${title}"`);
    return NextResponse.json({ success: true, data, message: 'Event created successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update event
export async function PUT(request) {
  try {
    const { fields, imageUrl: uploadedUrl, gcashQrUrl } = await parseEventRequest(request);
    const { id, actorId, ...updates } = fields;

    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    // RBAC: only Admin/Super Admin may edit
    const actor = await verifyEventManager(actorId);
    if (!actor) return FORBIDDEN();

    const updateData = {};
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.eventDate) updateData.event_date = updates.eventDate;
    if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
    if (updates.location !== undefined) updateData.location = updates.location;
    if (uploadedUrl) updateData.image_url = uploadedUrl;
    else if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;
    mapEventConfig(updates, updateData, gcashQrUrl);

    const { data, error } = await supabase.from('events').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    const isArchive = updates.isActive === false || updates.isActive === 'false';
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

    await logEventAudit(actor, 'delete_event', id, 'Deleted event');
    return NextResponse.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
