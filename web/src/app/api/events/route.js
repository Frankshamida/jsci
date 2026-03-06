import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
    const body = await request.json();
    const { title, description, eventDate, endDate, location, imageUrl, createdBy } = body;

    if (!title || !eventDate) {
      return NextResponse.json({ success: false, message: 'Title and event date are required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('events').insert({
      title, description, event_date: eventDate, end_date: endDate || null,
      location, image_url: imageUrl || null, created_by: createdBy,
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
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const updateData = {};
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.eventDate) updateData.event_date = updates.eventDate;
    if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
    if (updates.location !== undefined) updateData.location = updates.location;
    if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl;
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
