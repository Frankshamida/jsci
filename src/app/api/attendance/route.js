import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch attendance records
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const eventDate = searchParams.get('eventDate');

    let query = supabase.from('attendance').select('*, users!attendance_user_id_fkey(firstname, lastname, ministry)').order('event_date', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    if (eventDate) query = query.eq('event_date', eventDate);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Mark attendance (Pastor, Admin)
export async function POST(request) {
  try {
    const { userId, scheduleId, eventDate, status, markedBy, notes } = await request.json();
    if (!userId || !eventDate) {
      return NextResponse.json({ success: false, message: 'User ID and event date required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('attendance').upsert({
      user_id: userId, schedule_id: scheduleId || null, event_date: eventDate,
      status: status || 'Present', marked_by: markedBy, notes,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Attendance recorded' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update attendance
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, status, notes } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const updateData = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    const { data, error } = await supabase.from('attendance').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Attendance updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Delete attendance record
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const { error } = await supabase.from('attendance').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Attendance record deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
