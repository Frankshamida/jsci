import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const { username, answer } = await request.json();

    if (!username || !answer) {
      return NextResponse.json({ success: false, message: 'Username and answer are required' }, { status: 400 });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('security_answer')
      .eq('username', username.trim())
      .single();

    if (error || !user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    // Compare hashed security answer
    const answerMatch = await bcrypt.compare(answer.trim().toLowerCase(), user.security_answer);
    if (!answerMatch) {
      return NextResponse.json({ success: false, message: 'Incorrect security answer' }, { status: 401 });
    }

    return NextResponse.json({ success: true, message: 'Security answer verified' });
  } catch (error) {
    console.error('Verify security answer error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
