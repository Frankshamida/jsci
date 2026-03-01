import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const { email, newPassword } = await request.json();

    if (!email || !newPassword) {
      return NextResponse.json({ success: false, message: 'Email and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('email', email.trim().toLowerCase());

    if (error) {
      return NextResponse.json({ success: false, message: 'Error updating password' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Password updated successfully!' });
  } catch (error) {
    console.error('Update password error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
