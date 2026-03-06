import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Get comments for a post (with like counts + author pics)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');
    const userId = searchParams.get('userId');
    if (!postId) return NextResponse.json({ success: false, message: 'Post ID required' }, { status: 400 });

    const { data, error } = await supabase.from('post_comments')
      .select('*').eq('post_id', postId).order('created_at', { ascending: true });

    if (error) throw error;

    // Get comment like counts + whether current user liked each
    const commentIds = data.map(c => c.id);
    let commentLikeCounts = {};
    let userLikedComments = new Set();

    if (commentIds.length > 0) {
      const { data: allLikes } = await supabase.from('comment_likes')
        .select('comment_id, user_id')
        .in('comment_id', commentIds);

      if (allLikes) {
        allLikes.forEach(l => {
          commentLikeCounts[l.comment_id] = (commentLikeCounts[l.comment_id] || 0) + 1;
          if (userId && l.user_id === userId) userLikedComments.add(l.comment_id);
        });
      }
    }

    // Get author profile pictures
    const authorIds = [...new Set(data.map(c => c.author_id).filter(Boolean))];
    let authorPicMap = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase.from('users')
        .select('id, profile_picture')
        .in('id', authorIds);
      if (profiles) profiles.forEach(p => { authorPicMap[p.id] = p.profile_picture; });
    }

    const enriched = data.map(c => ({
      ...c,
      likeCount: commentLikeCounts[c.id] || 0,
      liked: userLikedComments.has(c.id),
      author_picture: authorPicMap[c.author_id] || null,
    }));

    return NextResponse.json({ success: true, data: enriched });
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

// PUT - Edit comment (only the author)
export async function PUT(request) {
  try {
    const { id, userId, content } = await request.json();
    if (!id || !content) return NextResponse.json({ success: false, message: 'Comment ID and content required' }, { status: 400 });

    const { data: comment } = await supabase.from('post_comments').select('author_id').eq('id', id).single();
    if (!comment) return NextResponse.json({ success: false, message: 'Comment not found' }, { status: 404 });
    if (comment.author_id !== userId) return NextResponse.json({ success: false, message: 'You can only edit your own comments' }, { status: 403 });

    const { data, error } = await supabase.from('post_comments').update({ content }).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Delete comment (only the author)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
    if (!id || !userId) return NextResponse.json({ success: false, message: 'Comment ID and User ID required' }, { status: 400 });

    const { data: comment } = await supabase.from('post_comments').select('author_id').eq('id', id).single();
    if (!comment) return NextResponse.json({ success: false, message: 'Comment not found' }, { status: 404 });
    if (comment.author_id !== userId) return NextResponse.json({ success: false, message: 'You can only delete your own comments' }, { status: 403 });

    const { error } = await supabase.from('post_comments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
