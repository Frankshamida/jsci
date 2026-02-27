import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Get comments for a post
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');
    if (!postId) return NextResponse.json({ success: false, message: 'Post ID required' }, { status: 400 });

    const { data, error } = await supabase.from('post_comments')
      .select('*').eq('post_id', postId).order('created_at', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Add comment
export async function POST(request) {
  try {
    const { postId, authorId, authorName, content } = await request.json();
    if (!postId || !content) {
      return NextResponse.json({ success: false, message: 'Post ID and content required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('post_comments').insert({
      post_id: postId, author_id: authorId, author_name: authorName, content,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Comment added' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
