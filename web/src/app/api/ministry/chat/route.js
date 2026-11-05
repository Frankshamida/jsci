import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireMinistryUser, fullNameOf } from '@/lib/ministryAuth';
import { MESSAGE_COLUMNS, inRoom, ministryMembers, roomsFor, sendersById, touchReads } from '@/lib/ministryChat';

// GET - The caller's group chats, for the Chat tab and its badge:
//   [{ room, title, icon, memberCount, unread, lastMessage }]
// Busiest first; rooms with no messages yet keep their usual order.
// Asking also counts as receiving every room (the "Delivered" tick).
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  try {
    const rooms = roomsFor(user);
    const keys = rooms.map((r) => r.room);
    if (!keys.length) return NextResponse.json({ success: true, data: [] });

    const [reads, members] = await Promise.all([
      supabaseAdmin.from('ministry_chat_reads').select('room, read_at').eq('user_id', user.id).in('room', keys),
      ministryMembers(),
    ]);
    if (reads.error) throw reads.error;
    const readAt = Object.fromEntries((reads.data || []).map((r) => [r.room, r.read_at]));

    // Per room: the newest message, and how many from others came after I last looked.
    const perRoom = await Promise.all(rooms.map(async (r) => {
      let unread = supabaseAdmin.from('ministry_chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('room', r.room)
        .neq('sender_id', user.id)
        .is('deleted_at', null);
      if (readAt[r.room]) unread = unread.gt('created_at', readAt[r.room]);
      const [last, count] = await Promise.all([
        supabaseAdmin.from('ministry_chat_messages').select(MESSAGE_COLUMNS).eq('room', r.room).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        unread,
      ]);
      if (last.error) throw last.error;
      if (count.error) throw count.error;
      return { last: last.data || null, unread: count.count || 0 };
    }));

    const people = await sendersById(perRoom.map((p) => p.last?.sender_id).filter(Boolean));
    const data = rooms.map((r, i) => {
      const { last, unread } = perRoom[i];
      const sender = last ? people.get(last.sender_id) : null;
      return {
        room: r.room,
        title: r.title,
        icon: r.icon,
        memberCount: members.filter((u) => inRoom(u, r.room)).length,
        unread,
        lastMessage: last ? {
          id: last.id,
          body: last.deleted_at ? '' : last.body,
          deleted: !!last.deleted_at,
          senderId: last.sender_id,
          senderName: sender ? fullNameOf(sender) : 'Former member',
          createdAt: last.created_at,
        } : null,
      };
    });

    // Busiest first (newest message on top); the quiet ones after, in order.
    const order = keys;
    data.sort((a, b) => {
      const ta = a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0;
      const tb = b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0;
      if (ta || tb) return tb - ta;
      return order.indexOf(a.room) - order.indexOf(b.room);
    });

    await touchReads(user.id, keys);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/ministry/chat error:', error);
    return NextResponse.json({ success: false, message: 'Could not load your chats. Pull down to try again.' }, { status: 500 });
  }
}
