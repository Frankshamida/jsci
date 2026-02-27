import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const { username, newPassword } = await request.json();

    if (!username || !newPassword) {
      return NextResponse.json({ success: false, message: 'Username and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('username', username.trim());

    if (error) {
      return NextResponse.json({ success: false, message: 'Error resetting password' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Password reset successfully!' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
