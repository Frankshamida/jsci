import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';

async function logAudit(userId, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId || null,
      user_name: null,
      action, resource: 'event_registration',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// POST /api/events/registrations/pay  (multipart with `proof`, or JSON)
// A member submits/updates payment on their OWN registration — used when an event
// was free at signup time but the admin later turned on a fee (has_fee=true).
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

    const { registrationId, userId, paymentMethod, paymentReference } = fields;
    if (!registrationId || !userId) {
      return NextResponse.json({ success: false, message: 'registrationId and userId are required' }, { status: 400 });
    }

    const { data: reg, error: regErr } = await supabase
      .from('event_registrations')
      .select('id, user_id, event_id, status')
      .eq('id', registrationId).single();
    if (regErr || !reg) return NextResponse.json({ success: false, message: 'Registration not found' }, { status: 404 });
    if (reg.user_id !== userId) return NextResponse.json({ success: false, message: 'Not authorized' }, { status: 403 });
    if (reg.status === 'cancelled') return NextResponse.json({ success: false, message: 'This registration has been cancelled' }, { status: 400 });

    const { data: event, error: evErr } = await supabase
      .from('events')
      .select('id, has_fee, registration_fee, early_bird_price, early_bird_deadline')
      .eq('id', reg.event_id).single();
    if (evErr || !event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    if (!event.has_fee) return NextResponse.json({ success: false, message: 'This event no longer requires payment' }, { status: 400 });

    let amount = Number(event.registration_fee) || 0;
    if (event.early_bird_price != null && event.early_bird_deadline && new Date() <= new Date(event.early_bird_deadline)) {
      amount = Number(event.early_bird_price);
    }

    const update = {
      amount,
      payment_method: paymentMethod || null,
      payment_reference: paymentReference || null,
      status: (proofUrl || paymentReference) ? 'payment_submitted' : 'pending_payment',
    };
    if (proofUrl) update.payment_proof_url = proofUrl;

    const { data, error } = await supabase.from('event_registrations').update(update).eq('id', registrationId).select().single();
    if (error) throw error;

    await logAudit(userId, 'event_payment_submit', registrationId, `Payment submitted for registration ${registrationId} (₱${amount})`);
    return NextResponse.json({ success: true, data, message: 'Payment submitted. Your registration will be confirmed once verified.' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
