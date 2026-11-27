import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { addDays } from '@/lib/ministryApp';
import { loadCare } from '@/lib/joyfulCaresServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// ============================================================
// GET /api/cares/digest - Monday morning, from Vercel Cron (vercel.json):
// each Pastor gets one notification, "Joyful Cares this week", saying how many
// members need a follow-up, how many to watch and which follow-ups are due.
// Tapping it opens Joyful Cares.
//
// When CRON_SECRET is set in Vercel, only Vercel's own call (which sends it)
// is let in. Either way it is sent at most once a week to each Pastor, so a
// second call in the same week changes nothing.
// ============================================================

const TITLE = 'Joyful Cares this week';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Not allowed.' }, { status: 401 });
  }
  try {
    const data = await loadCare();
    // This week's Monday, in the Philippines.
    const dow = new Date(`${data.today}T00:00:00Z`).getUTCDay();
    const monday = addDays(data.today, -((dow + 6) % 7));
    const since = new Date(`${monday}T00:00:00+08:00`).toISOString();

    const { follow, watch, care, due } = data.totals;
    const parts = [
      follow ? `${plural(follow, 'member')} ${follow === 1 ? 'needs' : 'need'} a follow-up` : null,
      watch ? `${watch} to watch` : null,
      due ? `${plural(due, 'follow-up')} due` : null,
      care ? `${care} in care` : null,
    ].filter(Boolean);
    const message = parts.length ? `${parts.join(', ')}.` : 'Everyone is doing well this week. Thank God!';

    let sent = 0;
    for (const p of data.pastors) {
      const { count } = await supabaseAdmin.from('notifications').select('id', { count: 'exact', head: true })
        .eq('user_id', p.id).eq('title', TITLE).gte('created_at', since);
      if (count) continue;
      const { error } = await supabaseAdmin.from('notifications').insert({
        user_id: p.id, title: TITLE, message, type: follow || due ? 'warning' : 'info', link: 'joyful-cares',
      });
      if (!error) sent += 1;
    }
    return NextResponse.json({ success: true, sent, pastors: data.pastors.length, message });
  } catch (error) {
    console.error('cares digest:', error?.message || error);
    return NextResponse.json({ success: false, message: 'The digest could not be made.' }, { status: 500 });
  }
}
