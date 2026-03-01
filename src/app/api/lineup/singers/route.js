import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch users who can be backup singers
// Returns users from "Praise And Worship" ministry with sub_role "Singers"
// OR users with role "Song Leader" (they can also sing backup)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'singers'; // 'singers' | 'all-paw'

    let query = supabase.from('users')
      .select('id, firstname, lastname, ministry, sub_role, role')
      .eq('is_active', true)
      .eq('status', 'Verified');

    if (type === 'singers') {
      // Get users with Praise And Worship ministry who are Singers, or Song Leaders
      query = query.or('sub_role.eq.Singers,role.eq.Song Leader');
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
      ministry: u.ministry,
      sub_role: u.sub_role,
      role: u.role,
    }));

    return NextResponse.json({ success: true, data: singers });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
