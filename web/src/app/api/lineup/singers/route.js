import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch users who can be backup singers OR song leaders
// type=song-leaders -> Ministry: Praise And Worship, Sub Role: Song Leaders
// type=backupers -> Ministry: Praise And Worship, Sub Role: Backup Singer
// type=musicians -> Ministry: Praise And Worship, Sub Role: Instrumentalist (every
//                   Musician carries it; their instruments are in sub_role)
// type=dancers -> Ministry: Praise And Worship, Sub Role: Dancer / Head Dancer
// type=all-paw -> All Praise And Worship ministry members
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all-paw';

    let query = supabase.from('users')
      .select('id, firstname, lastname, email, ministry, sub_role, role, profile_picture')
      .eq('is_active', true)
      .eq('status', 'Verified');

    if (type === 'song-leaders') {
      // Get users with ministry Praise And Worship AND sub_role containing Song Leaders
      query = query.eq('ministry', 'Praise And Worship').ilike('sub_role', '%Song Leaders%');
    } else if (type === 'backupers') {
      // Get users with ministry Praise And Worship AND sub_role Backup Singer
      query = query.eq('ministry', 'Praise And Worship').ilike('sub_role', '%Backup Singer%');
    } else if (type === 'musicians') {
      query = query.eq('ministry', 'Praise And Worship').ilike('sub_role', '%Instrumentalist%');
    } else if (type === 'dancers') {
      // Dancer or Head Dancer
      query = query.eq('ministry', 'Praise And Worship').ilike('sub_role', '%Dancer%');
    } else {
      // Get all Praise And Worship ministry members
      query = query.eq('ministry', 'Praise And Worship');
    }

    query = query.order('firstname', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    // Format names for dropdown
    const singers = (data || []).map(u => ({
      id: u.id,
      name: `${u.firstname} ${u.lastname}`,
      // Separately too, for short labels ("Frank", or "Frank G." when two share it)
      firstname: u.firstname,
      lastname: u.lastname,
      email: u.email,
      ministry: u.ministry,
      sub_role: u.sub_role,
      role: u.role,
      profile_picture: u.profile_picture || null,
    }));

    return NextResponse.json({ success: true, data: singers });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
