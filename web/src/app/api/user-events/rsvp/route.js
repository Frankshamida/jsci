import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST - RSVP to a user event
export async function POST(request) {
  try {
    const { eventId, userId, status } = await request.json();
    if (!eventId || !userId) {
      return NextResponse.json({ success: false, message: 'Event ID and User ID required' }, { status: 400 });
    }

    const validStatuses = ['Going', 'Maybe', 'Not Going'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ success: false, message: 'Invalid RSVP status' }, { status: 400 });
    }

    const { data, error } = await supabase.from('user_event_rsvps').upsert({
      event_id: eventId,
      user_id: userId,
      status: status || 'Going',
    }, { onConflict: 'event_id,user_id' }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: `RSVP updated to ${status}` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// GET - Get RSVPs for a user event (with user details)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');

    if (!eventId) {
      return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('user_event_rsvps')
      .select('*, users(id, firstname, lastname, ministry, role, email)')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by status
    const grouped = {
      going: (data || []).filter(r => r.status === 'Going'),
      maybe: (data || []).filter(r => r.status === 'Maybe'),
      notGoing: (data || []).filter(r => r.status === 'Not Going'),
    };

    return NextResponse.json({
      success: true,
      data,
      grouped,
      counts: {
        going: grouped.going.length,
        maybe: grouped.maybe.length,
        notGoing: grouped.notGoing.length,
        total: (data || []).length,
      }
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Remove RSVP
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    const userId = searchParams.get('userId');

    if (!eventId || !userId) {
      return NextResponse.json({ success: false, message: 'Event ID and User ID required' }, { status: 400 });
    }

    const { error } = await supabase.from('user_event_rsvps')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', userId);

    if (error) throw error;
    return NextResponse.json({ success: true, message: 'RSVP removed' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
