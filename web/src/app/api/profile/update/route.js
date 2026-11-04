import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { DASHBOARD_KEYS } from '@/lib/userRoles';
import { formatPersonName } from '@/lib/eventFormat';

// GET - Fetch a user's public profile by userId (used when viewing another member)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, firstname, lastname, email, birthdate, life_verse, profile_picture, role, ministry')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ success: false, message: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { email, firstname, lastname, birthdate, life_verse, default_dashboard } = await request.json();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 });
    }

    const updateData = {};
    // "frank DwEEZel gomez" is saved as "Frank Dweezel Gomez"
    if (firstname?.trim()) updateData.firstname = formatPersonName(firstname);
    if (lastname?.trim()) updateData.lastname = formatPersonName(lastname, { continues: true });
    if (birthdate !== undefined) updateData.birthdate = birthdate || null;
    if (life_verse !== undefined) updateData.life_verse = life_verse ? life_verse.trim() : null;
    // Where the account opens after signing in (Preferences > Start Dashboard).
    if (default_dashboard !== undefined) {
      if (default_dashboard !== null && !DASHBOARD_KEYS.includes(default_dashboard)) {
        return NextResponse.json({ success: false, message: 'Unknown dashboard' }, { status: 400 });
      }
      updateData.default_dashboard = default_dashboard;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('email', email.trim().toLowerCase())
      .select()
      .single();

    if (error) {
      console.error('Profile update error:', error);
      return NextResponse.json({ success: false, message: 'Error updating profile' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully!',
      data: {
        firstname: data.firstname,
        lastname: data.lastname,
        birthdate: data.birthdate,
        life_verse: data.life_verse,
        default_dashboard: data.default_dashboard ?? null,
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
