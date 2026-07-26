import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';

const EVENT_MANAGER_ROLES = ['Admin', 'Super Admin'];

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
      const { data, error } = await supabase
        .from('event_registrations')
        .select('id, attendee_name, status, created_at, event:events(id, title)')
        .in('status', ['payment_submitted', 'pending_payment', 'registered'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return NextResponse.json({ success: true, count: (data || []).length, data: data || [] });
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

    const { eventId, userId, attendeeName, attendeeEmail, attendeeMobile, paymentMethod, paymentReference } = fields;
    if (!eventId || !attendeeName) {
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
      if ((count || 0) >= event.max_participants) {
        return NextResponse.json({ success: false, message: 'This event is already full' }, { status: 400 });
      }
    }

    // Prevent duplicate registration
    if (userId) {
      const { data: existing } = await supabase.from('event_registrations')
        .select('id, status').eq('event_id', eventId).eq('user_id', userId).neq('status', 'cancelled').maybeSingle();
      if (existing) return NextResponse.json({ success: false, message: 'You are already registered for this event' }, { status: 409 });
    }

    // Determine amount (early bird if applicable) & status
    let amount = 0;
    let status = 'registered';
    if (event.has_fee) {
      amount = Number(event.registration_fee) || 0;
      if (event.early_bird_price != null && event.early_bird_deadline && new Date() <= new Date(event.early_bird_deadline)) {
        amount = Number(event.early_bird_price);
      }
      status = (proofUrl || paymentReference) ? 'payment_submitted' : 'pending_payment';
    }

    const { data, error } = await supabase.from('event_registrations').insert({
      event_id: eventId, user_id: userId || null,
      attendee_name: attendeeName, attendee_email: attendeeEmail || null, attendee_mobile: attendeeMobile || null,
      amount, payment_method: paymentMethod || null, payment_reference: paymentReference || null,
      payment_proof_url: proofUrl, status,
    }).select().single();
    if (error) throw error;

    await logAudit(null, 'event_register', data.id, `${attendeeName} registered for "${event.title}" (${status})`);
    return NextResponse.json({ success: true, data, message: event.has_fee ? 'Registration submitted' : 'You are registered!' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT /api/events/registrations  { id, actorId, status }            -> admin verifies/updates a registration
//                                { id, actorId, attended: true|false } -> admin marks/clears attendance (QR check-in)
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
    }
    if (attended === true) { update.attended = true; update.attended_at = new Date().toISOString(); update.attended_by = actor.id; }
    else if (attended === false) { update.attended = false; update.attended_at = null; update.attended_by = null; }

    const { data, error } = await supabase.from('event_registrations').update(update).eq('id', id).select().single();
    if (error) throw error;

    await logAudit(actor, attended !== undefined ? 'event_attendance_update' : 'event_registration_update', id, attended !== undefined ? `Set attendance to ${attended}` : `Set registration to ${status}`);
    return NextResponse.json({ success: true, data, message: attended !== undefined ? (attended ? 'Marked attended' : 'Attendance cleared') : 'Registration updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
