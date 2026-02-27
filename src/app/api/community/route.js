import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch community posts
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 50;

    const { data: posts, error } = await supabase.from('community_posts')
      .select('*').eq('is_active', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Get like counts and comment counts
    for (let post of posts) {
      const { count: likeCount } = await supabase.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', post.id);
      const { count: commentCount } = await supabase.from('post_comments').select('*', { count: 'exact', head: true }).eq('post_id', post.id);
      post.likeCount = likeCount || 0;
      post.commentCount = commentCount || 0;
    }

    return NextResponse.json({ success: true, data: posts });
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

// DELETE
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const { error } = await supabase.from('community_posts').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
