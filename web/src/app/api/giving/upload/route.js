import { NextResponse } from 'next/server';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { givingAdmin } from '@/lib/givingServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;

// POST /api/giving/upload  multipart { actorId, file }
// A campaign's picture (Admin and Super Admin). Shrunk in the browser first;
// Cloudinary keeps it at most 1600 px wide.
export async function POST(request) {
  try {
    const form = await request.formData();
    const who = await givingAdmin(form.get('actorId'));
    if (who.error) return NextResponse.json({ success: false, message: who.error }, { status: who.status });
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ success: false, message: 'Choose a picture to upload.' }, { status: 400 });
    if (!TYPES.includes(file.type)) return NextResponse.json({ success: false, message: 'Use a JPG, PNG or WebP picture.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ success: false, message: 'That picture is larger than 4 MB. Try a smaller one.' }, { status: 413 });
    const up = await uploadBufferToCloudinary(await file.arrayBuffer(), {
      fileName: file.name || 'giving',
      mimeType: file.type,
      folder: 'JSCI-System/giving',
      resourceType: 'image',
    });
    return NextResponse.json({ success: true, data: { url: up.secureUrl } });
  } catch (error) {
    console.error('[giving upload]', error.message);
    return NextResponse.json({ success: false, message: error.message || 'The picture could not be uploaded.' }, { status: 500 });
  }
}
