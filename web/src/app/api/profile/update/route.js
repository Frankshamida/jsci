import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
