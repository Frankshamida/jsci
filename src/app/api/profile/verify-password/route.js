import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const { username, currentPassword } = await request.json();

    if (!username || !currentPassword) {
      return NextResponse.json({ success: false, message: 'Username and password are required' }, { status: 400 });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('password')
      .eq('username', username.trim())
      .single();

    if (error || !user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return NextResponse.json({ success: false, message: 'Current password is incorrect' }, { status: 401 });
    }

    return NextResponse.json({ success: true, message: 'Password verified' });
  } catch (error) {
    console.error('Verify password error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
