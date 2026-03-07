import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Public endpoint: Fetch active live streams (no auth required)
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('live_streams')
      .select('id, iframe_url, caption, title, posted_by_name, is_live, created_at')
      .eq('is_active', true)
      .eq('is_live', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get reaction and comment counts
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
