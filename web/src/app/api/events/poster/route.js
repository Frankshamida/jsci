import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/events/poster?id=..   an event's title and poster
// GET /api/events/poster         the event on today - or the next one, or the last
//
// For the screens turned towards the attendees (/qr-display): the poster is
// their background. Only published, active events, and only what is already
// on the public event page - the title and the picture.

const COLUMNS = 'id, title, image_url, event_date, end_date';
const ms = (v) => (v ? new Date(v).getTime() || 0 : 0);

export async function GET(request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    const base = () => supabaseAdmin.from('events').select(COLUMNS).eq('is_active', true).eq('is_published', true);

    let event = null;
    if (id) {
      const { data, error } = await base().eq('id', id).maybeSingle();
      if (error) throw error;
      event = data;
    } else {
      const { data, error } = await base().order('event_date', { ascending: true }).limit(500);
      if (error) throw error;
      const now = Date.now();
      // On until the end of the day it ends (or starts, with no end date) -
      // the day in the Philippines, whatever the server's clock is set to.
      const endOf = (e) => {
        const day = new Date(ms(e.end_date) || ms(e.event_date)).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
        return new Date(`${day}T23:59:59.999+08:00`).getTime();
      };
      const list = (data || []).filter((e) => ms(e.event_date));
      event = list.find((e) => ms(e.event_date) <= now && now <= endOf(e))
        || list.find((e) => ms(e.event_date) > now)
        || list[list.length - 1]
        || null;
    }

    if (!event) return NextResponse.json({ success: false, message: 'Event not found' }, { status: 404 });
    return NextResponse.json({
      success: true,
      data: { id: event.id, title: event.title || '', image: event.image_url || '' },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
