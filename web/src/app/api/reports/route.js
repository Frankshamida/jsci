import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Generate reports/analytics
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'overview';

    if (type === 'overview') {
      const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
      const { count: verifiedUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('status', 'Verified');
      const { count: totalEvents } = await supabase.from('events').select('*', { count: 'exact', head: true }).eq('is_active', true);
      const { count: totalSchedules } = await supabase.from('schedules').select('*', { count: 'exact', head: true });
      const { count: totalAnnouncements } = await supabase.from('announcements').select('*', { count: 'exact', head: true }).eq('is_active', true);
      const { count: totalPosts } = await supabase.from('community_posts').select('*', { count: 'exact', head: true }).eq('is_active', true);
      const { count: totalMeetings } = await supabase.from('ministry_meetings').select('*', { count: 'exact', head: true });

      // Get users by role
      const { data: roleData } = await supabase.from('users').select('role');
      const roleDistribution = {};
      (roleData || []).forEach((u) => { roleDistribution[u.role] = (roleDistribution[u.role] || 0) + 1; });

      // Get users by ministry
      const { data: ministryData } = await supabase.from('users').select('ministry');
      const ministryDistribution = {};
      (ministryData || []).forEach((u) => { ministryDistribution[u.ministry] = (ministryDistribution[u.ministry] || 0) + 1; });

      return NextResponse.json({
        success: true,
        data: {
          totalUsers: totalUsers || 0,
          verifiedUsers: verifiedUsers || 0,
          totalEvents: totalEvents || 0,
          totalSchedules: totalSchedules || 0,
          totalAnnouncements: totalAnnouncements || 0,
          totalPosts: totalPosts || 0,
          totalMeetings: totalMeetings || 0,
          roleDistribution,
          ministryDistribution,
        },
      });
    }

    if (type === 'attendance') {
      const { data } = await supabase.from('attendance')
        .select('status, event_date')
        .order('event_date', { ascending: false })
        .limit(500);

      const summary = { Present: 0, Absent: 0, Late: 0, Excused: 0 };
      (data || []).forEach((a) => { summary[a.status] = (summary[a.status] || 0) + 1; });

      return NextResponse.json({ success: true, data: { records: data, summary } });
    }

    if (type === 'personal') {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

      const { data: attendanceData } = await supabase.from('attendance')
        .select('*').eq('user_id', userId).order('event_date', { ascending: false });

      const summary = { Present: 0, Absent: 0, Late: 0, Excused: 0 };
      (attendanceData || []).forEach((a) => { summary[a.status] = (summary[a.status] || 0) + 1; });

      return NextResponse.json({ success: true, data: { attendance: attendanceData, summary } });
    }

    return NextResponse.json({ success: false, message: 'Unknown report type' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
