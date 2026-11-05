import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { limit as rateLimit, tooManyRequests } from '@/lib/rateLimiter';
import { requireMinistryUser, fullNameOf } from '@/lib/ministryAuth';
import { MAX_BODY, MESSAGE_COLUMNS, inRoom, roomMembers, sendersById, shapeMessage, touchReads } from '@/lib/ministryChat';

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const PAGE = 50;
const DELETED_LOOKBACK_MS = 10 * 60 * 1000; // unsent messages reported to a poller that gives no `deletedSince`
const DELETED_MAX_MS = 24 * 60 * 60 * 1000;
const isTime = (v) => !!v && !Number.isNaN(Date.parse(v));

// GET - One room's messages, oldest first:
//   ?room=&after=<time>   newer than that (the 3-second poll while the room is open)
//   ?room=&before=<time>  the page before that (scrolling up)
//   ?room=                the newest page
//   &read=1               the caller has the room open: marks it seen
//   &deletedSince=<time>  also list messages unsent since then (deletedIds)
// With them: receipts (when each other member last received / saw the room),
// hasMore (another page that way), and serverTime for the next deletedSince.
export async function GET(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  const params = new URL(request.url).searchParams;
  const room = params.get('room');
  if (!inRoom(user, room)) return bad('Chat not found.', 404);
  const after = params.get('after');
  const before = params.get('before');
  if ((after && !isTime(after)) || (before && !isTime(before))) return bad('Bad time.');
  const size = Math.min(100, Math.max(1, parseInt(params.get('limit') || String(PAGE), 10) || PAGE));
  const serverTime = new Date().toISOString();

  try {
    // Seen first, so the reply already counts it.
    await touchReads(user.id, [room], { read: params.get('read') === '1' });

    let query = supabaseAdmin.from('ministry_chat_messages').select(MESSAGE_COLUMNS).eq('room', room);
    if (after) query = query.gt('created_at', after).order('created_at', { ascending: true });
    else {
      if (before) query = query.lt('created_at', before);
      query = query.order('created_at', { ascending: false });
    }
    const since = isTime(params.get('deletedSince'))
      ? new Date(Math.max(Date.parse(params.get('deletedSince')), Date.now() - DELETED_MAX_MS)).toISOString()
      : new Date(Date.now() - DELETED_LOOKBACK_MS).toISOString();

    const [page, unsent, reads, members] = await Promise.all([
      query.limit(size + 1),
      supabaseAdmin.from('ministry_chat_messages').select('id').eq('room', room).gte('deleted_at', since).limit(200),
      supabaseAdmin.from('ministry_chat_reads').select('user_id, delivered_at, read_at').eq('room', room).neq('user_id', user.id),
      roomMembers(room),
    ]);
    if (page.error) throw page.error;
    if (unsent.error) throw unsent.error;
    if (reads.error) throw reads.error;

    const rows = page.data || [];
    const hasMore = rows.length > size;
    const list = rows.slice(0, size);
    if (!after) list.reverse(); // always oldest first
    const people = await sendersById(list.map((m) => m.sender_id));

    // Only the people still in the room; members who never opened it have nothing to show.
    const inside = new Map(members.map((u) => [u.id, u]));
    const receipts = (reads.data || [])
      .filter((r) => inside.has(r.user_id) && (r.delivered_at || r.read_at))
      .map((r) => {
        const u = inside.get(r.user_id);
        return { userId: r.user_id, name: fullNameOf(u), picture: u.profile_picture || null, deliveredAt: r.delivered_at, readAt: r.read_at };
      });

    return NextResponse.json({
      success: true,
      data: {
        messages: list.map((m) => shapeMessage(m, people)),
        receipts,
        deletedIds: (unsent.data || []).map((m) => m.id),
        hasMore,
        memberCount: members.length,
        serverTime,
      },
    });
  } catch (error) {
    console.error('GET /api/ministry/chat/messages error:', error);
    return bad('Could not load the messages. Check your connection.', 500);
  }
}

// POST - Send a message: { room, body, clientId }. Sending the same clientId
// again (a retry after a dropped connection) returns the first copy.
export async function POST(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const { user } = auth;

  let input;
  try { input = await request.json(); } catch { return bad('Bad request.'); }
  const room = String(input?.room || '');
  const body = String(input?.body || '').trim();
  const clientId = input?.clientId ? String(input.clientId).slice(0, 64) : null;
  if (!inRoom(user, room)) return bad('Chat not found.', 404);
  if (!body) return bad('Write a message first.');
  if (body.length > MAX_BODY) return bad(`Messages can be up to ${MAX_BODY} characters.`);

  try {
    const people = await sendersById([user.id]);
    if (!people.has(user.id)) people.set(user.id, user);

    if (clientId) {
      const { data: existing } = await supabaseAdmin.from('ministry_chat_messages').select(MESSAGE_COLUMNS)
        .eq('sender_id', user.id).eq('client_id', clientId).maybeSingle();
      if (existing) return NextResponse.json({ success: true, data: shapeMessage(existing, people) });
    }

    const attempt = await rateLimit(`ministry-chat:${user.id}`, 30, 60 * 1000);
    if (!attempt.allowed) return tooManyRequests(attempt.retryAfterSec, 'You are sending messages very fast. Wait a moment and try again.');

    const { data, error } = await supabaseAdmin.from('ministry_chat_messages')
      .insert({ room, sender_id: user.id, body, client_id: clientId })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) {
      // Two copies of the same send raced: the other one won, return it.
      if (error.code === '23505' && clientId) {
        const { data: first } = await supabaseAdmin.from('ministry_chat_messages').select(MESSAGE_COLUMNS)
          .eq('sender_id', user.id).eq('client_id', clientId).maybeSingle();
        if (first) return NextResponse.json({ success: true, data: shapeMessage(first, people) });
      }
      throw error;
    }

    await touchReads(user.id, [room], { read: true });
    return NextResponse.json({ success: true, data: shapeMessage(data, people) });
  } catch (error) {
    console.error('POST /api/ministry/chat/messages error:', error);
    return bad('Could not send. Check your connection and try again.', 500);
  }
}

// DELETE - Unsend one of your own messages: ?id=
// It stays in its place as "Message removed" for everybody.
export async function DELETE(request) {
  const auth = await requireMinistryUser(request);
  if (auth.response) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('Message not found.', 404);

  try {
    const { data: message } = await supabaseAdmin.from('ministry_chat_messages').select('id, sender_id, deleted_at').eq('id', id).maybeSingle();
    if (!message || message.sender_id !== auth.user.id) return bad('Message not found.', 404);
    if (!message.deleted_at) {
      const { error } = await supabaseAdmin.from('ministry_chat_messages').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    }
    return NextResponse.json({ success: true, data: { id }, message: 'Message removed.' });
  } catch (error) {
    console.error('DELETE /api/ministry/chat/messages error:', error);
    return bad('Could not remove the message. Try again.', 500);
  }
}
