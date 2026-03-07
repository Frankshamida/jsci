import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST - Toggle heart reaction on a live stream
export async function POST(request) {
  try {
    const body = await request.json();
    const { stream_id, user_id, user_name } = body;

    if (!stream_id || !user_id) {
      return NextResponse.json({ error: 'stream_id and user_id are required' }, { status: 400 });
    }

    // Check if user already reacted
    const { data: existing } = await supabase
      .from('live_stream_reactions')
      .select('id')
      .eq('stream_id', stream_id)
      .eq('user_id', user_id)
      .single();

    if (existing) {
      // Remove reaction
      await supabase
        .from('live_stream_reactions')
        .delete()
        .eq('id', existing.id);

      return NextResponse.json({ action: 'removed' });
    } else {
      // Add reaction
      const { data, error } = await supabase
        .from('live_stream_reactions')
        .insert([{ stream_id, user_id, user_name, reaction_type: 'heart' }])
        .select()
        .single();

      if (error) throw error;

      return NextResponse.json({ action: 'added', data });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET - Get reaction count and user's reaction status
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const stream_id = searchParams.get('stream_id');
    const user_id = searchParams.get('user_id');

    if (!stream_id) {
      return NextResponse.json({ error: 'stream_id is required' }, { status: 400 });
    }

    const { count } = await supabase
      .from('live_stream_reactions')
      .select('*', { count: 'exact', head: true })
      .eq('stream_id', stream_id);

    let userReacted = false;
    if (user_id) {
      const { data } = await supabase
        .from('live_stream_reactions')
        .select('id')
        .eq('stream_id', stream_id)
        .eq('user_id', user_id)
        .single();
      userReacted = !!data;
    }

    return NextResponse.json({ count: count || 0, userReacted });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
