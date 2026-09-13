import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { findEventActor, isCommitteeMember, isEventManager } from '@/lib/eventCommittee';

export const dynamic = 'force-dynamic';

// Where the drawn mark is stored.
//
// The existing public `profile` bucket, under signatures/ - beside the avatars
// and the payment channel logos. No new bucket to provision, and the same
// public-read rule already applies, which is what lets a printed receipt show
// the mark without signing a URL every time one is opened.

const BUCKET = 'profile';
const FOLDER = 'signatures';
// A signature is line art on a transparent ground. At the size this is drawn
// and exported - see the pad in the dashboard - a WebP of one lands in the
// tens of kilobytes; a quarter of a megabyte means something other than a
// signature was sent.
const MAX_BYTES = 256 * 1024;

async function requireCommittee(actorId) {
  const actor = await findEventActor(actorId);
  if (!actor) return null;
  return (isEventManager(actor) || isCommitteeMember(actor)) ? actor : null;
}

// POST multipart: file (image/webp), actorId, replaces? -> { url, path }
//
// WebP only, and the conversion happens in the browser. The pad draws to a
// canvas and exports from it, so there is no format to guess at here and no
// image decoding on the server - the file either is a WebP or it is not
// something this route will store.
export async function POST(request) {
  try {
    const formData = await request.formData();
    const actor = await requireCommittee(formData.get('actorId'));
    if (!actor) return NextResponse.json({ success: false, message: 'Access denied.' }, { status: 403 });

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, message: 'No signature received' }, { status: 400 });
    }
    if (file.type !== 'image/webp') {
      return NextResponse.json({ success: false, message: 'The signature must be converted to WebP before upload.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, message: 'That signature file is too large (max 256KB).' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, message: 'Nothing was drawn.' }, { status: 400 });
    }

    // Named by the account, so every signature in the bucket can be traced to
    // one without a lookup - and stamped, so replacing one writes a new object
    // rather than fighting a CDN holding the old bytes at the same URL.
    const path = `${FOLDER}/${actor.id}-${Date.now()}.webp`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
    if (uploadError) {
      return NextResponse.json({ success: false, message: 'Error uploading signature: ' + uploadError.message }, { status: 500 });
    }

    // The one it replaces, if any. Dropped here rather than left behind, so an
    // account that has redrawn its signature nine times is not nine files.
    const replaces = formData.get('replaces');
    if (typeof replaces === 'string' && replaces.startsWith(`${FOLDER}/`) && replaces !== path) {
      try { await supabase.storage.from(BUCKET).remove([replaces]); } catch { /* non-fatal */ }
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ success: true, url: urlData.publicUrl, path, bytes: file.size });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
