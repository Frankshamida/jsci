import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch all live streams (active ones, sorted by newest)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') !== 'false';
    const liveOnly = searchParams.get('live') === 'true';

    let query = supabase
      .from('live_streams')
      .select('*')
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }
    if (liveOnly) {
      query = query.eq('is_live', true);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Get reaction counts for each stream
    const streamsWithCounts = await Promise.all(
      (data || []).map(async (stream) => {
        const { count: reactionCount } = await supabase
          .from('live_stream_reactions')
          .select('*', { count: 'exact', head: true })
          .eq('stream_id', stream.id);

        const { count: commentCount } = await supabase
          .from('live_stream_comments')
          .select('*', { count: 'exact', head: true })
          .eq('stream_id', stream.id);

        return {
          ...stream,
          reactionCount: reactionCount || 0,
          commentCount: commentCount || 0,
        };
      })
    );

    return NextResponse.json(streamsWithCounts);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Create a new live stream (Admin/SuperAdmin only)
export async function POST(request) {
  try {
    const body = await request.json();
    const { iframe_url, caption, title, posted_by, posted_by_name } = body;

    if (!iframe_url) {
      return NextResponse.json({ error: 'iframe_url is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('live_streams')
      .insert([{
        iframe_url,
        caption: caption || 'Sunday Service Live',
        title: title || 'Sunday Service Live',
        posted_by,
        posted_by_name,
        is_active: true,
        is_live: true,
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT - Update a live stream (toggle live/active, update caption)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Stream id is required' }, { status: 400 });
    }

    const updateData = { ...updates, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('live_streams')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Remove a live stream
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Stream id is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('live_streams')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
