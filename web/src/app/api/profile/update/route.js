import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
    const { email, firstname, lastname, birthdate, life_verse } = await request.json();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 });
    }

    const updateData = {};
    if (firstname) updateData.firstname = firstname.trim();
    if (lastname) updateData.lastname = lastname.trim();
    if (birthdate !== undefined) updateData.birthdate = birthdate || null;
    if (life_verse !== undefined) updateData.life_verse = life_verse ? life_verse.trim() : null;

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
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
