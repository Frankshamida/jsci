// A meeting as a calendar file: GET ?id=..&actorId=..
// Opening it adds the meeting to Apple Calendar, Outlook or any calendar app
// (with a reminder an hour before); on a phone it opens the calendar app.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadActor, canSee, shapeMeeting, loadPeople } from '@/lib/meetingsServer';
import { meetingIcs, icsFileName } from '@/lib/meetings';

export const dynamic = 'force-dynamic';

const bad = (message, status = 400) => new NextResponse(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const who = await loadActor(url.searchParams.get('actorId'));
    if (who.error) return bad(who.error, who.status);
    const { data: row } = await supabaseAdmin.from('ministry_meetings')
      .select('*').eq('id', String(url.searchParams.get('id') || '')).maybeSingle();
    if (!row || !canSee(who.user, row)) return bad('This meeting is no longer available.', 404);

    const meeting = shapeMeeting(row, { viewer: who.user, people: await loadPeople() });
    const ics = meetingIcs(meeting, { origin: url.origin, host: url.hostname || 'sanctuaryhub' });
    return new NextResponse(ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${icsFileName(meeting.title)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('meetings calendar:', error?.message || error);
    return bad('The calendar file could not be made. Please try again.', 500);
  }
}
