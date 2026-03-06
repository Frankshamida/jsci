import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch community posts (optimized - single query with counts)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 50;
    const userId = searchParams.get('userId');

    const { data: posts, error } = await supabase.from('community_posts')
      .select('*, post_likes(count), post_comments(count)')
      .eq('is_active', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Get user's liked post IDs in one query
    let likedPostIds = new Set();
    if (userId) {
      const { data: likes } = await supabase.from('post_likes')
        .select('post_id')
        .eq('user_id', userId);
      if (likes) likedPostIds = new Set(likes.map(l => l.post_id));
    }

    // Get author profile pictures in one query
    const authorIds = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
    let authorPicMap = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase.from('users')
        .select('id, profile_picture')
        .in('id', authorIds);
      if (profiles) {
        profiles.forEach(p => { authorPicMap[p.id] = p.profile_picture; });
      }
    }

    const enriched = posts.map(post => ({
      ...post,
      likeCount: post.post_likes?.[0]?.count || 0,
      commentCount: post.post_comments?.[0]?.count || 0,
      liked: likedPostIds.has(post.id),
      author_picture: authorPicMap[post.author_id] || null,
      post_likes: undefined,
      post_comments: undefined,
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create post
export async function POST(request) {
  try {
    const { authorId, authorName, content, imageUrl } = await request.json();
    if (!content) {
      return NextResponse.json({ success: false, message: 'Content required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('community_posts').insert({
      author_id: authorId, author_name: authorName, content, image_url: imageUrl || null,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Post created' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update post / Pin post
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const updateData = {};
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.isPinned !== undefined) updateData.is_pinned = updates.isPinned;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

    const { data, error } = await supabase.from('community_posts').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - only the post author can delete their own post
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
    if (!id || !userId) return NextResponse.json({ success: false, message: 'Post ID and User ID required' }, { status: 400 });

    // Verify ownership
    const { data: post } = await supabase.from('community_posts').select('author_id').eq('id', id).single();
    if (!post) return NextResponse.json({ success: false, message: 'Post not found' }, { status: 404 });
    if (post.author_id !== userId) return NextResponse.json({ success: false, message: 'You can only delete your own posts' }, { status: 403 });

    const { error } = await supabase.from('community_posts').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
