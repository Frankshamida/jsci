import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
    const { username, firstname, lastname } = await request.json();

    if (!username) {
      return NextResponse.json({ success: false, message: 'Username is required' }, { status: 400 });
    }

    const updateData = {};
    if (firstname) updateData.firstname = firstname.trim();
    if (lastname) updateData.lastname = lastname.trim();

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('username', username.trim())
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, message: 'Error updating profile' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully!',
      data: {
        firstname: data.firstname,
        lastname: data.lastname,
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
