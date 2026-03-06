import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST - Like/Unlike a comment
export async function POST(request) {
  try {
    const { commentId, userId } = await request.json();
    if (!commentId || !userId) {
      return NextResponse.json({ success: false, message: 'Comment ID and User ID required' }, { status: 400 });
    }

    const { data: existing } = await supabase.from('comment_likes')
      .select('id').eq('comment_id', commentId).eq('user_id', userId).single();

    if (existing) {
      await supabase.from('comment_likes').delete().eq('id', existing.id);
      return NextResponse.json({ success: true, liked: false });
    } else {
      await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId });
      return NextResponse.json({ success: true, liked: true });
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
