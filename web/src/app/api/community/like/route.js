import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const VALID_REACTIONS = ['heart', 'fire', 'praise'];

function safeJSON(data, status = 200) {
  try { return NextResponse.json(data, { status }); }
  catch { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
}

// GET - Fetch who reacted to a post
export async function GET(request) {
  try {
    let postId;
    try { postId = new URL(request.url).searchParams.get('postId'); } catch { return safeJSON({ success: false, message: 'Invalid request' }, 400); }
    if (!postId) return safeJSON({ success: false, message: 'Post ID required' }, 400);

    const { data: likes, error } = await supabase.from('post_likes')
      .select('user_id, reaction_type, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    if (error) { console.error('[community/like GET] error:', error.message); return safeJSON({ success: false, message: 'Failed to load reactions' }, 500); }

    // Get user names and pictures
    const userIds = [...new Set((likes || []).map(l => l.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length > 0) {
      try {
        const { data: users } = await supabase.from('users')
          .select('id, firstname, lastname, profile_picture')
          .in('id', userIds);
        if (users) users.forEach(u => { userMap[u.id] = u; });
      } catch { /* non-fatal */ }
    }

    const reactions = (likes || []).map(l => ({
      userId: l.user_id,
      reactionType: l.reaction_type || 'heart',
      name: userMap[l.user_id] ? `${userMap[l.user_id].firstname} ${userMap[l.user_id].lastname}` : 'Unknown',
      picture: userMap[l.user_id]?.profile_picture || null,
      createdAt: l.created_at,
    }));

    const counts = { heart: 0, fire: 0, praise: 0 };
    reactions.forEach(r => { if (counts[r.reactionType] !== undefined) counts[r.reactionType]++; });

    return safeJSON({ success: true, data: reactions, counts, total: reactions.length });
  } catch (error) {
    console.error('[community/like GET] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// POST - React/Unreact to a post (heart, fire, praise)
export async function POST(request) {
  try {
    let body;
    try { body = await request.json(); } catch { return safeJSON({ success: false, message: 'Invalid JSON body' }, 400); }

    const { postId, userId, reactionType } = body || {};
    if (!postId || !userId) {
      return safeJSON({ success: false, message: 'Post ID and User ID required' }, 400);
    }

    const type = VALID_REACTIONS.includes(reactionType) ? reactionType : 'heart';

    // Fetch ALL existing reaction rows for this user+post (there may be stray
    // duplicates from older races). Using this instead of .single() avoids
    // errors when more than one row exists, and lets us self-heal duplicates.
    let existingRows = [];
    try {
      const { data } = await supabase.from('post_likes')
        .select('id, reaction_type')
        .eq('post_id', postId)
        .eq('user_id', userId);
      existingRows = data || [];
    } catch { /* treat as none */ }

    const currentType = existingRows.length > 0 ? existingRows[0].reaction_type : null;

    // Toggle off: user tapped the same reaction they already have -> remove all
    if (existingRows.length > 0 && currentType === type) {
      try { await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId); } catch {}
      return safeJSON({ success: true, liked: false, reactionType: null, message: 'Reaction removed' });
    }

    // Otherwise: ensure EXACTLY ONE row with the new type.
    // Clear any existing rows first (removes duplicates), then insert one.
    if (existingRows.length > 0) {
      try { await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId); } catch {}
    }
    try {
      await supabase.from('post_likes').insert({ post_id: postId, user_id: userId, reaction_type: type });
    } catch (e) { console.error('[community/like POST] insert error:', e?.message); }
    return safeJSON({ success: true, liked: true, reactionType: type, message: currentType ? 'Reaction changed' : 'Reacted' });
  } catch (error) {
    console.error('[community/like POST] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}
