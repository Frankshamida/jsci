import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';

// Parse a request as JSON or multipart form-data (with optional image file).
// Returns { fields, imageUrl } where imageUrl is set if an image file was uploaded.
async function parseEventRequest(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const fields = {};
    for (const [key, value] of form.entries()) {
      if (key !== 'image') fields[key] = value;
    }
    let imageUrl;
    const file = form.get('image');
    if (file && typeof file === 'object' && file.size > 0) {
      const buffer = await file.arrayBuffer();
      const uploaded = await uploadBufferToCloudinary(buffer, {
        fileName: file.name || 'event-image',
        mimeType: file.type || 'image/jpeg',
        folder: 'JSCI-System/events',
        resourceType: 'image',
      });
      imageUrl = uploaded.secureUrl;
    }
    return { fields, imageUrl };
  }
  const body = await request.json();
  return { fields: body, imageUrl: undefined };
}

// GET - Fetch events
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 50;
    const upcoming = searchParams.get('upcoming') === 'true';

    let query = supabase.from('events').select('*').eq('is_active', true).order('event_date', { ascending: true }).limit(limit);
    if (upcoming) {
      query = query.gte('event_date', new Date().toISOString());
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
    const { fields, imageUrl: uploadedUrl } = await parseEventRequest(request);
    const { title, description, eventDate, endDate, location, imageUrl, createdBy } = fields;
    const finalImageUrl = uploadedUrl || imageUrl || null;

    if (!title || !eventDate) {
      return NextResponse.json({ success: false, message: 'Title and event date are required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('events').insert({
      title, description, event_date: eventDate, end_date: endDate || null,
      location, image_url: finalImageUrl, created_by: createdBy,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Event created successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update event
export async function PUT(request) {
  try {
    const { fields, imageUrl: uploadedUrl } = await parseEventRequest(request);
    const { id, ...updates } = fields;

    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const updateData = {};
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.eventDate) updateData.event_date = updates.eventDate;
    if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
    if (updates.location !== undefined) updateData.location = updates.location;
    if (uploadedUrl) updateData.image_url = uploadedUrl;
    else if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

    const { data, error } = await supabase.from('events').update(updateData).eq('id', id).select().single();
    if (error) throw error;

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
    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const { error } = await supabase.from('events').update({ is_active: false }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
