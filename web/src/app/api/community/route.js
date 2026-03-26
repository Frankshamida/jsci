import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadBufferToCloudinary, deleteFromCloudinary, buildCloudinaryImageUrl, cloudinaryDefaults } from '@/lib/cloudinary';

export const dynamic = 'force-dynamic';

// Safe error message
function safeMsg(e) {
  try {
    if (!e) return 'Unknown error';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message || 'Unknown error';
    return String(e);
  } catch { return 'Unknown error'; }
}

function safeJSON(data, status = 200, headers = {}) {
  try { return NextResponse.json(data, { status, headers }); }
  catch { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
}

// User-specific fields (liked/myReaction) make this response user-dependent.
// Disable shared caching so each user gets fresh personalization.
const FEED_CACHE_HEADERS = {
  'Cache-Control': 'no-store',
};

const imageTransform = { ...cloudinaryDefaults.image, width: 1400 };

function withDeliveryUrl(img) {
  if (!img) return img;
  return {
    ...img,
    delivery_url: buildCloudinaryImageUrl(img.google_drive_file_id, imageTransform),
  };
}

// GET - Fetch community posts (optimized - single query with counts)
export async function GET(request) {
  try {
    let limit = 50, userId = null, postId = null;
    try {
      const { searchParams } = new URL(request.url);
      limit = Math.min(Math.max(parseInt(searchParams.get('limit')) || 50, 1), 200);
      userId = searchParams.get('userId');
      postId = searchParams.get('postId');
    } catch { /* use defaults */ }

    const postQuery = supabase.from('community_posts')
      .select('*, post_likes(count), post_comments(count)')
      .eq('is_active', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    let postsResp;
    if (postId) {
      postsResp = await postQuery.eq('id', postId).limit(1);
    } else {
      postsResp = await postQuery.limit(limit);
    }

    const { data: posts, error } = postsResp;

    if (error) {
      console.error('[community GET] query error:', error.message);
      return safeJSON({ success: false, message: 'Failed to load posts' }, 500);
    }

    const safePosts = posts || [];
    const postIds = safePosts.map(p => p.id);

    // Get user's reaction types in one query
    let userReactionsMap = {};
    if (userId) {
      try {
        const { data: likes } = await supabase.from('post_likes')
          .select('post_id, reaction_type')
          .eq('user_id', userId);
        if (likes) likes.forEach(l => { userReactionsMap[l.post_id] = l.reaction_type || 'heart'; });
      } catch { /* non-fatal */ }
    }

    // Get reaction counts grouped by type for all posts
    let postReactionCounts = {};
    if (postIds.length > 0) {
      try {
        const { data: allLikes } = await supabase.from('post_likes')
          .select('post_id, reaction_type')
          .in('post_id', postIds);
        if (allLikes) {
          allLikes.forEach(l => {
            if (!postReactionCounts[l.post_id]) postReactionCounts[l.post_id] = { heart: 0, fire: 0, praise: 0, total: 0 };
            const rType = l.reaction_type || 'heart';
            if (postReactionCounts[l.post_id][rType] !== undefined) postReactionCounts[l.post_id][rType]++;
            postReactionCounts[l.post_id].total++;
          });
        }
      } catch { /* non-fatal */ }
    }

    // Get author profile pictures in one query
    const authorIds = [...new Set(safePosts.map(p => p.author_id).filter(Boolean))];
    let authorPicMap = {};
    if (authorIds.length > 0) {
      try {
        const { data: profiles } = await supabase.from('users')
          .select('id, profile_picture')
          .in('id', authorIds);
        if (profiles) profiles.forEach(p => { authorPicMap[p.id] = p.profile_picture; });
      } catch { /* non-fatal */ }
    }

    // Get images for all posts in one query
    let postImagesMap = {};
    if (postIds.length > 0) {
      try {
        const { data: images } = await supabase.from('community_post_images')
          .select('*')
          .in('post_id', postIds)
          .order('display_order', { ascending: true });
        if (images) {
          images.forEach(img => {
            if (!postImagesMap[img.post_id]) postImagesMap[img.post_id] = [];
            postImagesMap[img.post_id].push(withDeliveryUrl(img));
          });
        }
      } catch { /* non-fatal */ }
    }

    const enriched = safePosts.map(post => ({
      ...post,
      likeCount: postReactionCounts[post.id]?.total || 0,
      reactionCounts: postReactionCounts[post.id] || { heart: 0, fire: 0, praise: 0, total: 0 },
      commentCount: post.post_comments?.[0]?.count || 0,
      liked: !!userReactionsMap[post.id],
      myReaction: userReactionsMap[post.id] || null,
      author_picture: authorPicMap[post.author_id] || null,
      images: postImagesMap[post.id] || [],
      post_likes: undefined,
      post_comments: undefined,
    }));

    return safeJSON({ success: true, data: enriched }, 200, FEED_CACHE_HEADERS);
  } catch (error) {
    console.error('[community GET] CRITICAL:', safeMsg(error));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// POST - Create post (supports multipart with images or JSON)
export async function POST(request) {
  try {
    let contentType = '';
    try { contentType = request.headers.get('content-type') || ''; } catch { contentType = ''; }

    if (contentType.includes('multipart/form-data')) {
      let formData;
      try { formData = await request.formData(); } catch (e) {
        return safeJSON({ success: false, message: 'Failed to parse form data' }, 400);
      }

      const authorId = formData.get('authorId');
      const authorName = formData.get('authorName');
      const content = formData.get('content') || '';
      const files = formData.getAll('images');

      if (!content && (!files || files.length === 0)) {
        return safeJSON({ success: false, message: 'Content or images required' }, 400);
      }

      // Create the post first
      let post;
      try {
        const { data: postData, error: postError } = await supabase.from('community_posts').insert({
          author_id: authorId, author_name: authorName, content: content || '',
        }).select().single();
        if (postError) { console.error('[community POST] insert error:', postError.message); return safeJSON({ success: false, message: 'Failed to create post' }, 500); }
        post = postData;
      } catch (e) { return safeJSON({ success: false, message: 'Failed to create post' }, 500); }

      // Upload images to Cloudinary and save references
      const uploadedImages = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file || !file.size) continue;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const fileName = `community_${post.id}_${Date.now()}_${i}_${(file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const mimeType = file.type || 'image/jpeg';
          const cloudinary = await uploadBufferToCloudinary(arrayBuffer, {
            fileName,
            mimeType,
            folder: 'JSCI-System/community',
            resourceType: 'image',
          });

          const { data: imgData, error: imgError } = await supabase.from('community_post_images').insert({
            post_id: post.id,
            google_drive_file_id: cloudinary.publicId,
            file_name: file.name || 'photo',
            mime_type: mimeType,
            file_size_bytes: file.size,
            display_order: i,
          }).select().single();

          if (!imgError && imgData) uploadedImages.push(withDeliveryUrl(imgData));
        } catch (uploadErr) {
          console.error('[community POST] Image upload error:', safeMsg(uploadErr));
        }
      }

      return safeJSON({ success: true, data: { ...post, images: uploadedImages }, message: 'Post created' });
    }

    // JSON body (text-only post)
    let body;
    try { body = await request.json(); } catch {
      return safeJSON({ success: false, message: 'Invalid JSON body' }, 400);
    }

    const { authorId, authorName, content, imageUrl } = body || {};
    if (!content) {
      return safeJSON({ success: false, message: 'Content required' }, 400);
    }

    try {
      const { data, error } = await supabase.from('community_posts').insert({
        author_id: authorId, author_name: authorName, content, image_url: imageUrl || null,
      }).select().single();

      if (error) { console.error('[community POST] insert error:', error.message); return safeJSON({ success: false, message: 'Failed to create post' }, 500); }
      return safeJSON({ success: true, data: { ...data, images: [] }, message: 'Post created' });
    } catch (e) { return safeJSON({ success: false, message: 'Failed to create post' }, 500); }
  } catch (error) {
    console.error('[community POST] CRITICAL:', safeMsg(error));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// PUT - Update post / Pin post / Add or remove images
export async function PUT(request) {
  try {
    let contentType = '';
    try { contentType = request.headers.get('content-type') || ''; } catch { contentType = ''; }

    if (contentType.includes('multipart/form-data')) {
      let formData;
      try { formData = await request.formData(); } catch {
        return safeJSON({ success: false, message: 'Failed to parse form data' }, 400);
      }

      const id = formData.get('id');
      const content = formData.get('content');
      let removeImageIds = [];
      try { removeImageIds = JSON.parse(formData.get('removeImageIds') || '[]'); } catch { removeImageIds = []; }
      const files = formData.getAll('newImages');

      if (!id) return safeJSON({ success: false, message: 'ID required' }, 400);

      // Update post content
      if (content !== null && content !== undefined) {
        try {
          const { error } = await supabase.from('community_posts').update({ content }).eq('id', id);
          if (error) console.error('[community PUT] update content error:', error.message);
        } catch (e) { console.error('[community PUT] update content crash:', safeMsg(e)); }
      }

      // Remove images
      for (const imgId of removeImageIds) {
        try {
          const { data: img } = await supabase.from('community_post_images')
            .select('google_drive_file_id').eq('id', imgId).single();
          if (img?.google_drive_file_id) {
            try { await deleteFromCloudinary(img.google_drive_file_id, 'image'); } catch (e) { console.warn('[community PUT] Cloudinary delete warning:', safeMsg(e)); }
          }
          await supabase.from('community_post_images').delete().eq('id', imgId);
        } catch (e) { console.warn('[community PUT] image remove error:', safeMsg(e)); }
      }

      // Upload new images
      let nextOrder = 0;
      try {
        const { data: existingImages } = await supabase.from('community_post_images')
          .select('display_order').eq('post_id', id).order('display_order', { ascending: false }).limit(1);
        nextOrder = (existingImages?.[0]?.display_order ?? -1) + 1;
      } catch { /* use 0 */ }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file || !file.size) continue;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const fileName = `community_${id}_${Date.now()}_${i}_${(file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const mimeType = file.type || 'image/jpeg';
          const cloudinary = await uploadBufferToCloudinary(arrayBuffer, {
            fileName,
            mimeType,
            folder: 'JSCI-System/community',
            resourceType: 'image',
          });
          await supabase.from('community_post_images').insert({
            post_id: id,
            google_drive_file_id: cloudinary.publicId,
            file_name: file.name || 'photo', mime_type: mimeType,
            file_size_bytes: file.size, display_order: nextOrder++,
          });
        } catch (e) { console.error('[community PUT] image upload error:', safeMsg(e)); }
      }

      try {
        const { data: updatedPost } = await supabase.from('community_posts').select('*').eq('id', id).single();
        return safeJSON({ success: true, data: updatedPost });
      } catch { return safeJSON({ success: true, data: { id } }); }
    }

    // JSON body (text update, pin, etc.)
    let body;
    try { body = await request.json(); } catch {
      return safeJSON({ success: false, message: 'Invalid JSON body' }, 400);
    }

    const { id, ...updates } = body || {};
    if (!id) return safeJSON({ success: false, message: 'ID required' }, 400);

    const updateData = {};
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.isPinned !== undefined) updateData.is_pinned = updates.isPinned;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

    try {
      const { data, error } = await supabase.from('community_posts').update(updateData).eq('id', id).select().single();
      if (error) { console.error('[community PUT] update error:', error.message); return safeJSON({ success: false, message: 'Failed to update post' }, 500); }
      return safeJSON({ success: true, data });
    } catch (e) { return safeJSON({ success: false, message: 'Failed to update post' }, 500); }
  } catch (error) {
    console.error('[community PUT] CRITICAL:', safeMsg(error));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// DELETE - only the post author can delete their own post
export async function DELETE(request) {
  try {
    let id, userId;
    try {
      const { searchParams } = new URL(request.url);
      id = searchParams.get('id');
      userId = searchParams.get('userId');
    } catch { return safeJSON({ success: false, message: 'Invalid request URL' }, 400); }

    if (!id || !userId) return safeJSON({ success: false, message: 'Post ID and User ID required' }, 400);

    // Verify ownership
    let post;
    try {
      const { data } = await supabase.from('community_posts').select('author_id').eq('id', id).single();
      post = data;
    } catch { return safeJSON({ success: false, message: 'Post not found' }, 404); }

    if (!post) return safeJSON({ success: false, message: 'Post not found' }, 404);
    if (post.author_id !== userId) return safeJSON({ success: false, message: 'You can only delete your own posts' }, 403);

    // Delete images from Cloudinary (best-effort)
    try {
      const { data: images } = await supabase.from('community_post_images')
        .select('google_drive_file_id').eq('post_id', id);
      if (images) {
        for (const img of images) {
          if (img?.google_drive_file_id) {
            try { await deleteFromCloudinary(img.google_drive_file_id, 'image'); } catch (e) { console.warn('[community DELETE] Cloudinary cleanup:', safeMsg(e)); }
          }
        }
      }
    } catch { /* non-fatal */ }

    // Soft-delete post
    try {
      const { error } = await supabase.from('community_posts').update({ is_active: false }).eq('id', id);
      if (error) { console.error('[community DELETE] soft-delete error:', error.message); return safeJSON({ success: false, message: 'Failed to delete post' }, 500); }
    } catch (e) { return safeJSON({ success: false, message: 'Failed to delete post' }, 500); }

    return safeJSON({ success: true, message: 'Post deleted' });
  } catch (error) {
    console.error('[community DELETE] CRITICAL:', safeMsg(error));
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}
