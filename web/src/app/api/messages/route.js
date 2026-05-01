import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

// GET - Fetch messages for a user
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const mode = searchParams.get('mode') || '';
    const type = searchParams.get('type') || 'inbox'; // inbox, sent, broadcast

    if (!userId) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    if (mode === 'users') {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, firstname, lastname, role, profile_picture, chat_is_online, chat_last_seen, status')
        .neq('id', userId)
        .eq('status', 'Verified')
        .order('firstname', { ascending: true });
      if (usersError) {
        return NextResponse.json({ success: false, message: 'Chat presence columns are missing. Run the SQL migration first.', details: usersError.message }, { status: 500 });
      }

      let { data: messageRows, error: messageRowsError } = await supabase
        .from('messages')
        .select('sender_id, receiver_id, content, created_at, is_read, is_unsent')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .eq('is_broadcast', false)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (messageRowsError && messageRowsError.message?.includes('column "is_unsent" does not exist')) {
        const fallback = await supabase
          .from('messages')
          .select('sender_id, receiver_id, content, created_at, is_read')
          .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
          .eq('is_broadcast', false)
          .order('created_at', { ascending: false })
          .limit(1000);
        messageRows = fallback.data;
        messageRowsError = fallback.error;
      }
      if (messageRowsError) throw messageRowsError;

      const convMap = new Map();
      for (const row of (messageRows || [])) {
        const peerId = row.sender_id === userId ? row.receiver_id : row.sender_id;
        if (!peerId) continue;
        const previewText = row.is_unsent ? 'Message unsent' : row.content;
        if (!convMap.has(peerId)) convMap.set(peerId, { unread_count: 0, last_message: previewText, last_message_at: row.created_at });
        const entry = convMap.get(peerId);
        if (row.receiver_id === userId && !row.is_read) entry.unread_count += 1;
      }

      const now = Date.now();
      const hydrated = (users || []).map((u) => {
        const meta = convMap.get(u.id) || {};
        const lastSeen = u.chat_last_seen ? new Date(u.chat_last_seen).getTime() : 0;
        const isOnline = Boolean(u.chat_is_online && lastSeen && (now - lastSeen <= ONLINE_WINDOW_MS));
        return {
          ...u,
          is_online: isOnline,
          unread_count: meta.unread_count || 0,
          last_message: meta.last_message || '',
          last_message_at: meta.last_message_at || null,
        };
      });

      hydrated.sort((a, b) => {
        if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
        if (a.last_message_at && b.last_message_at) return new Date(b.last_message_at) - new Date(a.last_message_at);
        if (a.last_message_at) return -1;
        if (b.last_message_at) return 1;
        return `${a.firstname} ${a.lastname}`.localeCompare(`${b.firstname} ${b.lastname}`);
      });

      return NextResponse.json({ success: true, data: hydrated });
    }

    if (mode === 'thread') {
      const withUserId = searchParams.get('withUserId');
      if (!withUserId) return NextResponse.json({ success: false, message: 'withUserId required' }, { status: 400 });

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(`and(sender_id.eq.${userId},receiver_id.eq.${withUserId}),and(sender_id.eq.${withUserId},receiver_id.eq.${userId})`)
        .eq('is_broadcast', false)
        .order('created_at', { ascending: true });

      if (error) throw error;

      await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('sender_id', withUserId)
        .eq('receiver_id', userId)
        .eq('is_read', false);

      return NextResponse.json({ success: true, data });
    }

    let query;
    if (type === 'sent') {
      query = supabase.from('messages').select('*, users!messages_receiver_id_fkey(firstname, lastname)')
        .eq('sender_id', userId).eq('is_broadcast', false).order('created_at', { ascending: false });
    } else if (type === 'broadcast') {
      query = supabase.from('messages').select('*, users!messages_sender_id_fkey(firstname, lastname, profile_picture)')
        .eq('is_broadcast', true).order('created_at', { ascending: false });
    } else {
      query = supabase.from('messages').select('*, users!messages_sender_id_fkey(firstname, lastname, profile_picture)')
        .or(`receiver_id.eq.${userId},and(is_broadcast.eq.true)`)
        .order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Send message
export async function POST(request) {
  try {
    const { senderId, receiverId, subject, content, isBroadcast, broadcastTarget } = await request.json();
    if (!senderId || !content) {
      return NextResponse.json({ success: false, message: 'Sender and content required' }, { status: 400 });
    }

    if (isBroadcast) {
      const { data, error } = await supabase.from('messages').insert({
        sender_id: senderId, receiver_id: senderId, subject, content,
        is_broadcast: true, broadcast_target: broadcastTarget || 'all',
      }).select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, data, message: 'Broadcast sent' });
    }

    if (!receiverId) {
      return NextResponse.json({ success: false, message: 'Receiver required for direct messages' }, { status: 400 });
    }

    const { data, error } = await supabase.from('messages').insert({
      sender_id: senderId, receiver_id: receiverId, subject: subject || null, content,
      is_broadcast: false,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Message sent' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Mark as read OR Edit message
export async function PUT(request) {
  try {
    const { id, userId, withUserId, messageId, content, senderId } = await request.json();
    
    // CASE 1: Edit message
    if (messageId && content && senderId) {
      const { data: msg, error: fetchErr } = await supabase
        .from('messages')
        .select('id, sender_id')
        .eq('id', messageId)
        .single();
        
      if (fetchErr || !msg) return NextResponse.json({ success: false, message: 'Message not found' }, { status: 404 });
      if (msg.sender_id !== senderId) return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

      const { error } = await supabase
        .from('messages')
        .update({ content, is_edited: true })
        .eq('id', messageId);
        
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Message updated' });
    }

    // CASE 2: Mark as read
    if (!id && !(userId && withUserId)) {
      return NextResponse.json({ success: false, message: 'Message ID or user pair required' }, { status: 400 });
    }

    let query = supabase.from('messages').update({ is_read: true });
    if (id) query = query.eq('id', id);
    else query = query.eq('receiver_id', userId).eq('sender_id', withUserId).eq('is_read', false);

    const { error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Marked as read' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PATCH - Update chat presence (online/offline + last seen)
export async function PATCH(request) {
  try {
    const { userId, isOnline = true } = await request.json();
    if (!userId) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    const { error } = await supabase
      .from('users')
      .update({
        chat_is_online: Boolean(isOnline),
        chat_last_seen: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Unsend a message (soft delete)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');
    const senderId = searchParams.get('senderId');

    if (!messageId || !senderId) {
      return NextResponse.json({ success: false, message: 'Message ID and Sender ID required' }, { status: 400 });
    }

    // Only the sender can unsend their own message
    const { data: msg, error: fetchErr } = await supabase
      .from('messages')
      .select('id, sender_id')
      .eq('id', messageId)
      .single();

    if (fetchErr || !msg) {
      return NextResponse.json({ success: false, message: 'Message not found' }, { status: 404 });
    }

    if (msg.sender_id !== senderId) {
      return NextResponse.json({ success: false, message: 'You can only unsend your own messages' }, { status: 403 });
    }

    const { error } = await supabase
      .from('messages')
      .update({ is_unsent: true, content: '' })
      .eq('id', messageId);

    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Message unsent' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
