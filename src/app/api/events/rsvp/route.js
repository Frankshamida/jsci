import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST - RSVP to event
export async function POST(request) {
  try {
    const { eventId, userId, status } = await request.json();
    if (!eventId || !userId) {
      return NextResponse.json({ success: false, message: 'Event ID and User ID required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('event_rsvps').upsert({
      event_id: eventId, user_id: userId, status: status || 'Going',
    }, { onConflict: 'event_id,user_id' }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// GET - Get RSVPs for an event
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ success: false, message: 'Event ID required' }, { status: 400 });

    const { data, error } = await supabase.from('event_rsvps')
      .select('*, users(firstname, lastname, ministry)')
      .eq('event_id', eventId);

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
