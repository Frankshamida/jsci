import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary, deleteFromCloudinary } from '@/lib/cloudinary';

// Default ISOM content (used when the table/row doesn't exist yet)
const DEFAULT_ISOM = {
  subtitle: 'Be equipped, empowered, and sent — a Spirit-filled ministry training program raising up the next generation of kingdom leaders.',
  about_html: `<h3>About ISOM</h3>
<p>The International School of Ministries (ISOM) is our church's Spirit-led training program designed to raise up believers into confident, biblically-grounded servants and leaders. Through hands-on teaching, prayer, and mentorship, students grow in their walk with Christ and are equipped to serve effectively in ministry and in their communities.</p>
<p>Whether you are new to ministry or seeking to deepen your calling, ISOM offers a place to learn, grow, and be sent out to make a kingdom impact.</p>`,
  bullets: [
    'Solid biblical foundation & sound doctrine',
    'Spirit-empowered prayer & worship',
    'Hands-on leadership & ministry training',
    'A heart to reach the nations for Christ',
  ],
  class_start_date: 'August 2026',
  slides: [
    { url: '/assets/isom-training.jpg' },
    { url: '/assets/christian-leadership-conference.jpg' },
    { url: '/assets/friday-bible-study.jpg' },
    { url: '/assets/worship-service.jpg' },
    { url: '/assets/community-outreach.jpg' },
  ],
};

async function getLatestRow() {
  const { data, error } = await supabase
    .from('isom_content')
    .select('*')
    .order('id', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

// GET - Fetch ISOM content (public)
export async function GET() {
  try {
    const data = await getLatestRow();
    if (!data) {
      return NextResponse.json({ success: true, data: { ...DEFAULT_ISOM, updated_at: null, updated_by: 'System' } });
    }
    return NextResponse.json({
      success: true,
      data: {
        subtitle: data.subtitle || DEFAULT_ISOM.subtitle,
        about_html: data.about_html || DEFAULT_ISOM.about_html,
        bullets: Array.isArray(data.bullets) ? data.bullets : DEFAULT_ISOM.bullets,
        class_start_date: data.class_start_date || DEFAULT_ISOM.class_start_date,
        slides: Array.isArray(data.slides) && data.slides.length ? data.slides : DEFAULT_ISOM.slides,
        updated_at: data.updated_at,
        updated_by: data.updated_by,
      },
    });
  } catch (error) {
    console.error('ISOM fetch error:', error.message);
    return NextResponse.json({ success: true, data: { ...DEFAULT_ISOM, updated_at: null, updated_by: 'System' } });
  }
}

// PUT - Update ISOM text content (Super Admin only)
export async function PUT(request) {
  try {
    const { subtitle, aboutHtml, bullets, classStartDate, updatedBy } = await request.json();

    const existing = await getLatestRow();

    const payload = {
      subtitle: subtitle ?? '',
      about_html: aboutHtml ?? '',
      bullets: Array.isArray(bullets) ? bullets : [],
      class_start_date: classStartDate ?? '',
      updated_by: updatedBy || 'Admin',
      updated_at: new Date().toISOString(),
    };

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('isom_content')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('isom_content')
        .insert({ ...payload, slides: DEFAULT_ISOM.slides })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ success: true, data: result, message: 'ISOM content updated successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Upload and add a new carousel slide image (Super Admin only)
export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get('image');
    if (!file || typeof file !== 'object' || file.size === 0) {
      return NextResponse.json({ success: false, message: 'Image file is required' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const uploaded = await uploadBufferToCloudinary(buffer, {
      fileName: file.name || 'isom-slide',
      mimeType: file.type || 'image/jpeg',
      folder: 'JSCI-System/isom',
      resourceType: 'image',
    });

    const existing = await getLatestRow();
    const currentSlides = existing && Array.isArray(existing.slides) ? existing.slides : DEFAULT_ISOM.slides;
    const newSlide = { url: uploaded.secureUrl, publicId: uploaded.publicId };
    const slides = [...currentSlides, newSlide];

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('isom_content')
        .update({ slides, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('isom_content')
        .insert({ ...DEFAULT_ISOM, slides })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ success: true, data: result, message: 'Slide uploaded successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Remove a carousel slide by index (Super Admin only)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const index = parseInt(searchParams.get('index'), 10);

    const existing = await getLatestRow();
    if (!existing) {
      return NextResponse.json({ success: false, message: 'No ISOM content found' }, { status: 404 });
    }

    const slides = Array.isArray(existing.slides) ? [...existing.slides] : [];
    if (Number.isNaN(index) || index < 0 || index >= slides.length) {
      return NextResponse.json({ success: false, message: 'Invalid slide index' }, { status: 400 });
    }

    const [removed] = slides.splice(index, 1);
    if (removed?.publicId) {
      try { await deleteFromCloudinary(removed.publicId, 'image'); } catch { /* best-effort */ }
    }

    const { data, error } = await supabase
      .from('isom_content')
      .update({ slides, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Slide removed successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
