import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch notifications
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    const { data, error } = await supabase.from('notifications')
      .select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create notification
export async function POST(request) {
  try {
    const { userId, title, message, type, link } = await request.json();
    if (!userId || !title) {
      return NextResponse.json({ success: false, message: 'User ID and title required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('notifications').insert({
      user_id: userId, title, message, type: type || 'info', link,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Mark notification as read
export async function PUT(request) {
  try {
    const { id, markAll, userId } = await request.json();

    if (markAll && userId) {
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId);
      return NextResponse.json({ success: true, message: 'All notifications marked as read' });
    }

    if (!id) return NextResponse.json({ success: false, message: 'Notification ID required' }, { status: 400 });
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Notification read' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
