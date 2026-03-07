import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch comments for a live stream (with replies nested)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const stream_id = searchParams.get('stream_id');
    const user_id = searchParams.get('user_id');

    if (!stream_id) {
      return NextResponse.json({ error: 'stream_id is required' }, { status: 400 });
    }

    // Fetch all comments for the stream
    const { data: comments, error } = await supabase
      .from('live_stream_comments')
      .select('*')
      .eq('stream_id', stream_id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Fetch like counts for all comments
    const commentIds = (comments || []).map(c => c.id);
    let likeCounts = {};
    let userLikes = {};

    if (commentIds.length > 0) {
      // Get counts
      const { data: allLikes } = await supabase
        .from('live_stream_comment_likes')
        .select('comment_id, user_id')
        .in('comment_id', commentIds);

      (allLikes || []).forEach(like => {
        likeCounts[like.comment_id] = (likeCounts[like.comment_id] || 0) + 1;
        if (like.user_id === user_id) {
          userLikes[like.comment_id] = true;
        }
      });
    }

    // Enrich comments
    const enriched = (comments || []).map(c => ({
      ...c,
      likeCount: likeCounts[c.id] || 0,
      liked: !!userLikes[c.id],
    }));

    // Separate top-level and replies
    const topLevel = enriched.filter(c => !c.parent_id);
    const replies = enriched.filter(c => c.parent_id);

    // Nest replies under parent comments
    const nested = topLevel.map(comment => ({
      ...comment,
      replies: replies.filter(r => r.parent_id === comment.id),
    }));

    return NextResponse.json(nested);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Add a comment or reply
export async function POST(request) {
  try {
    const body = await request.json();
    const { stream_id, user_id, user_name, user_picture, content, parent_id } = body;

    if (!stream_id || !user_id || !content) {
      return NextResponse.json({ error: 'stream_id, user_id, and content are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('live_stream_comments')
      .insert([{
        stream_id,
        user_id,
        user_name,
        user_picture,
        content,
        parent_id: parent_id || null,
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Edit a comment
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, content, user_id } = body;

    if (!id || !content) {
      return NextResponse.json({ error: 'id and content are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('live_stream_comments')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a comment
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const user_id = searchParams.get('user_id');

    if (!id) {
      return NextResponse.json({ error: 'Comment id is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('live_stream_comments')
      .delete()
      .eq('id', id)
      .eq('user_id', user_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
