import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST - Like/Unlike a post
export async function POST(request) {
  try {
    const { postId, userId } = await request.json();
    if (!postId || !userId) {
      return NextResponse.json({ success: false, message: 'Post ID and User ID required' }, { status: 400 });
    }

    // Check if already liked
    const { data: existing } = await supabase.from('post_likes')
      .select('id').eq('post_id', postId).eq('user_id', userId).single();

    if (existing) {
      // Unlike
      await supabase.from('post_likes').delete().eq('id', existing.id);
      return NextResponse.json({ success: true, liked: false, message: 'Post unliked' });
    } else {
      // Like
      await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
      return NextResponse.json({ success: true, liked: true, message: 'Post liked' });
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
