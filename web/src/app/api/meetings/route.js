import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch meetings
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ministry = searchParams.get('ministry'); // User's ministry
    const role = searchParams.get('role');
    const upcoming = searchParams.get('upcoming') === 'true';

    let query = supabase.from('ministry_meetings').select('*').order('meeting_date', { ascending: true });
    
    // Role-based filtering
    if (role !== 'Admin' && role !== 'Super Admin' && role !== 'Pastor' && ministry) {
      // Show meetings where ministry column contains the user's ministry
      query = query.ilike('ministry', `%${ministry}%`);
    }

    if (upcoming) query = query.gte('meeting_date', new Date().toISOString());

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create meeting
export async function POST(request) {
  try {
    const { title, description, ministry, meetingDate, location, createdBy, createdByName } = await request.json();
    if (!title || !ministry || !meetingDate) {
      return NextResponse.json({ success: false, message: 'Title, ministry and date required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('ministry_meetings').insert({
      title, description, ministry, meeting_date: meetingDate,
      location, created_by: createdBy, created_by_name: createdByName,
      status: 'Scheduled'
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Meeting scheduled successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update meeting
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const updateData = {};
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.ministry) updateData.ministry = updates.ministry;
    if (updates.meetingDate) updateData.meeting_date = updates.meetingDate;
    if (updates.location !== undefined) updateData.location = updates.location;
    if (updates.status) updateData.status = updates.status;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('ministry_meetings').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Meeting updated successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Cancel meeting
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const mode = searchParams.get('mode'); // 'hard' or 'soft'

    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    if (mode === 'hard') {
      const { error } = await supabase.from('ministry_meetings').delete().eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Meeting deleted permanently' });
    } else {
      const { error } = await supabase.from('ministry_meetings').update({ status: 'Cancelled' }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Meeting marked as cancelled' });
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
