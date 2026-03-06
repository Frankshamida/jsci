import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

// Set password for Google OAuth users who don't have one yet
export async function POST(request) {
  try {
    const { email, newPassword } = await request.json();

    if (!email || !newPassword) {
      return NextResponse.json({ success: false, message: 'Email and password are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Verify this is a Google user (password = 'GOOGLE_AUTH')
    const { data: user, error: lookupError } = await supabase
      .from('users')
      .select('id, password, google_id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (lookupError || !user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    if (user.password !== 'GOOGLE_AUTH' && !user.google_id) {
      return NextResponse.json({ success: false, message: 'This account already has a password set' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', user.id);

    if (error) {
      return NextResponse.json({ success: false, message: 'Error setting password' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Password created successfully! You can now log in with your email and password.' });
  } catch (error) {
    console.error('Set password error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
