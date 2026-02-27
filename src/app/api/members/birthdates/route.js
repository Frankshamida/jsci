import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET all member birthdates
export async function GET() {
  try {
    const { data: members, error } = await supabase
      .from('users')
      .select('firstname, lastname, birthdate, ministry, status')
      .not('birthdate', 'is', null);

    if (error) {
      return NextResponse.json({ success: false, message: 'Error fetching birthdates' }, { status: 500 });
    }

    const formatted = (members || []).map((m) => ({
      fullName: `${m.firstname} ${m.lastname}`,
      birthdate: m.birthdate,
      ministry: m.ministry,
      status: m.status,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Get birthdates error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}

// POST - same data, just different method for compatibility
export async function POST() {
  return GET();
}
