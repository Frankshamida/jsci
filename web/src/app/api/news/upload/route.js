import { NextResponse } from 'next/server';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { newsEditor } from '@/lib/newsServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/news/upload  multipart { actorId, file }
// A picture for an article - the thumbnail or one in the body. The editor
// shrinks it in the browser first (a phone photo is often 5-10 MB; Vercel
// takes 4.5 MB a request), and Cloudinary keeps it at most 1600 px wide.
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request) {
  try {
    const form = await request.formData();
    const who = await newsEditor(form.get('actorId'));
    if (who.error) return NextResponse.json({ success: false, message: who.error }, { status: who.status });

    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ success: false, message: 'Choose a picture to upload.' }, { status: 400 });
    }
    if (!TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, message: 'Use a JPG, PNG, WebP or GIF picture.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, message: 'That picture is still larger than 4 MB. Try a smaller one.' }, { status: 413 });
    }

    const uploaded = await uploadBufferToCloudinary(await file.arrayBuffer(), {
      fileName: file.name || 'news-image',
      mimeType: file.type,
      folder: 'JSCI-System/news',
      resourceType: 'image',
    });
    return NextResponse.json({ success: true, data: { url: uploaded.secureUrl, publicId: uploaded.publicId } });
  } catch (error) {
    console.error('[news upload]', error.message);
    return NextResponse.json({ success: false, message: error.message || 'The picture could not be uploaded.' }, { status: 500 });
  }
}
