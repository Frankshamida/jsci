import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - the live streams, newest first (the Community Hub's live player).
// ?active=false includes hidden ones; ?live=true only the ones live now.
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

// Posting, editing, putting live and deleting a stream is Dashboard > Social
// Media > Sunday Service, through /api/live-streams/manage - Admin and Super
// Admin only, checked on the server.
