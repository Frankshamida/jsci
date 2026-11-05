import { NextResponse } from 'next/server';
import { requireMinistryUser } from '@/lib/ministryAuth';
import { churchDate } from '@/lib/ministryApp';
import { isMonth, loadMonth } from '@/lib/ministrySchedule';

// GET - One month of the schedule: ?month=YYYY-MM (default: this month).
//   lineups  that month's lineups, with each person's excuse / sub / swap
//   days     the caller's status on every Sunday and lineup date:
//            serving, rest (a lineup without them), excused, covered, unplotted
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const month = new URL(request.url).searchParams.get('month') || churchDate().slice(0, 7);
  if (!isMonth(month)) return NextResponse.json({ success: false, message: 'Pick a month.' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await loadMonth(auth.user, month) });
  } catch (error) {
    console.error('GET /api/ministry/schedule error:', error);
    return NextResponse.json({ success: false, message: 'Could not load that month. Try again.' }, { status: 500 });
  }
}
