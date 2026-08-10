import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { rateLimit } from '@/lib/serverCache';

export const dynamic = 'force-dynamic';

const MANAGER_ROLES = ['Admin', 'Super Admin', 'Pastor'];

async function verifyManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabase.from('users').select('id, firstname, lastname, role').eq('id', actorId).single();
    if (data && MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* ignore */ }
  return null;
}

async function logAudit(actor, action, resourceId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: actor?.id || null,
      user_name: actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'Public',
      action, resource: 'isom_inquiry',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}

// GET ?actorId=..  -> list all inquiries (Admin / Super Admin only)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const actor = await verifyManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const { data, error } = await supabase
      .from('isom_inquiries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// Church roles offered in the "Role in Church" dropdown. Kept server-side too so a
// direct API call can't stash an arbitrary/malicious string in church_role.
const CHURCH_ROLES = [
  'Pastor', 'Associate Pastor', 'Elder', 'Deacon', 'Ministry Leader',
  'Worship/Song Leader', 'Usher', 'Volunteer', 'Member', 'Other',
];

// POST  { fullName, email, mobile, churchName, churchRole, message }  -> public "Inquire" form submission
export async function POST(request) {
  try {
    const { fullName, email, mobile, churchName, churchRole, message } = await request.json();

    if (!fullName || !fullName.trim()) {
      return NextResponse.json({ success: false, message: 'Your name is required' }, { status: 400 });
    }
    if (!email?.trim() && !mobile?.trim()) {
      return NextResponse.json({ success: false, message: 'Please provide an email or mobile number so we can reach you' }, { status: 400 });
    }
    if (churchRole && !CHURCH_ROLES.includes(churchRole)) {
      return NextResponse.json({ success: false, message: 'Invalid role selected' }, { status: 400 });
    }

    // Cheap abuse guard on a public, unauthenticated endpoint.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limited = rateLimit(`isom-inquiry:${ip}`, 5, 10 * 60 * 1000);
    if (!limited.allowed) {
      return NextResponse.json({ success: false, message: 'Too many inquiries submitted. Please try again later.' }, { status: 429 });
    }

    const { data, error } = await supabase.from('isom_inquiries').insert({
      full_name: fullName.trim(),
      email: email?.trim() || null,
      mobile: mobile?.trim() || null,
      church_name: churchName?.trim() || null,
      church_role: churchRole?.trim() || null,
      message: message?.trim() || null,
      status: 'new',
    }).select().single();
    if (error) throw error;

    await logAudit(null, 'isom_inquiry_submit', data.id, `${fullName.trim()} inquired about ISOM`);
    return NextResponse.json({ success: true, data, message: 'Thanks for reaching out! Our ISOM team will contact you soon.' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PATCH  { id, actorId, status }  -> update an inquiry's follow-up status (admin only)
export async function PATCH(request) {
  try {
    const { id, actorId, status } = await request.json();
    if (!id || !status) return NextResponse.json({ success: false, message: 'id and status are required' }, { status: 400 });

    const valid = ['new', 'contacted', 'enrolled', 'closed'];
    if (!valid.includes(status)) return NextResponse.json({ success: false, message: 'Invalid status' }, { status: 400 });

    const actor = await verifyManager(actorId);
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });

    const update = { status };
    if (status !== 'new') { update.contacted_by = actor.id; update.contacted_at = new Date().toISOString(); }

    const { data, error } = await supabase.from('isom_inquiries').update(update).eq('id', id).select().single();
    if (error) throw error;

    await logAudit(actor, 'isom_inquiry_update', id, `Set inquiry status to ${status}`);
    return NextResponse.json({ success: true, data, message: 'Inquiry updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
