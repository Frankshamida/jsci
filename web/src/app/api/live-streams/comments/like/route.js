import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST - Toggle heart like on a comment
export async function POST(request) {
  try {
    const body = await request.json();
    const { comment_id, user_id, user_name } = body;

    if (!comment_id || !user_id) {
      return NextResponse.json({ error: 'comment_id and user_id are required' }, { status: 400 });
    }

    // Check existing like
    const { data: existing } = await supabase
      .from('live_stream_comment_likes')
      .select('id')
      .eq('comment_id', comment_id)
      .eq('user_id', user_id)
      .single();

    if (existing) {
      await supabase
        .from('live_stream_comment_likes')
        .delete()
        .eq('id', existing.id);

      return NextResponse.json({ action: 'removed' });
    } else {
      const { data, error } = await supabase
        .from('live_stream_comment_likes')
        .insert([{ comment_id, user_id, user_name }])
        .select()
        .single();

      if (error) throw error;

      return NextResponse.json({ action: 'added', data });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
