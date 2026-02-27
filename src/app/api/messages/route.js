import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch messages for a user
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type') || 'inbox'; // inbox, sent, broadcast

    if (!userId) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    let query;
    if (type === 'sent') {
      query = supabase.from('messages').select('*, users!messages_receiver_id_fkey(firstname, lastname)')
        .eq('sender_id', userId).eq('is_broadcast', false).order('created_at', { ascending: false });
    } else if (type === 'broadcast') {
      query = supabase.from('messages').select('*, users!messages_sender_id_fkey(firstname, lastname)')
        .eq('is_broadcast', true).order('created_at', { ascending: false });
    } else {
      query = supabase.from('messages').select('*, users!messages_sender_id_fkey(firstname, lastname)')
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
      sender_id: senderId, receiver_id: receiverId, subject, content,
      is_broadcast: false,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Message sent' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Mark as read
export async function PUT(request) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ success: false, message: 'Message ID required' }, { status: 400 });

    const { error } = await supabase.from('messages').update({ is_read: true }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Marked as read' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
