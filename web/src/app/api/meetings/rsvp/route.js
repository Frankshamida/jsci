import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST - RSVP to meeting
export async function POST(request) {
  try {
    const { meetingId, userId, status } = await request.json();
    if (!meetingId || !userId) {
      return NextResponse.json({ success: false, message: 'Meeting ID and User ID required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('meeting_rsvps').upsert({
      meeting_id: meetingId, user_id: userId, status: status || 'Going',
    }, { onConflict: 'meeting_id,user_id' }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
