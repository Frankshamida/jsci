import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
      return NextResponse.json({ success: false, message: 'Username is required' }, { status: 400 });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('username, security_question')
      .eq('username', username.trim())
      .single();

    if (error || !user) {
      return NextResponse.json({ success: false, message: 'Username not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        username: user.username,
        securityQuestion: user.security_question,
      },
    });
  } catch (error) {
    console.error('Verify username error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
