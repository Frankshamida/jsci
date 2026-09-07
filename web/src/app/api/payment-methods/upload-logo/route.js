import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const MANAGER_ROLES = ['Admin', 'Super Admin', 'Pastor'];

// Logos live alongside avatars in the existing public `profile` bucket, so no
// extra Supabase bucket has to be provisioned.
const BUCKET = 'profile';
const FOLDER = 'payment-methods';
const MAX_BYTES = 2 * 1024 * 1024;

async function verifyManager(actorId) {
  if (!actorId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('id, role').eq('id', actorId).single();
    if (data && MANAGER_ROLES.includes(data.role)) return data;
  } catch { /* ignore */ }
  return null;
}

// POST  multipart: file (image/webp), actorId  -> { url }
// The client converts the picked image to WebP before uploading, so the stored
// object is always a .webp.
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const actor = await verifyManager(formData.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, message: 'No image received' }, { status: 400 });
    }
    if (file.type !== 'image/webp') {
      return NextResponse.json({ success: false, message: 'Logo must be converted to WebP before upload' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, message: 'Logo is too large (max 2MB)' }, { status: 400 });
    }

    const fileName = `${FOLDER}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(fileName, buffer, { contentType: 'image/webp', upsert: true });
    if (uploadError) {
      return NextResponse.json({ success: false, message: 'Error uploading logo: ' + uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(fileName);
    return NextResponse.json({ success: true, url: urlData.publicUrl, path: fileName });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE ?path=payment-methods/xxx.webp&actorId=..  -> remove a replaced logo
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');
    const actor = await verifyManager(searchParams.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied. Admins only.' }, { status: 403 });
    if (!path || !path.startsWith(`${FOLDER}/`)) {
      return NextResponse.json({ success: false, message: 'Invalid path' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
