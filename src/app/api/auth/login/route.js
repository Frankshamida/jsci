import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ success: false, message: 'Username and password are required' }, { status: 400 });
    }

    // Find user by username
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username.trim())
      .single();

    if (error || !user) {
      return NextResponse.json({ success: false, message: 'Invalid username or password' }, { status: 401 });
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return NextResponse.json({ success: false, message: 'Invalid username or password' }, { status: 401 });
    }

    // Check if account is active
    if (user.is_active === false) {
      return NextResponse.json({ success: false, message: 'Account has been deactivated. Contact admin.' }, { status: 403 });
    }

    // Update last login
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    // Return user data (without password)
    const userData = {
      id: user.id,
      memberId: user.member_id,
      firstname: user.firstname,
      lastname: user.lastname,
      username: user.username,
      birthdate: user.birthdate,
      ministry: user.ministry,
      role: user.role || 'Member',
      status: user.status,
      isActive: user.is_active !== false,
    };

    return NextResponse.json({ success: true, data: userData });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
