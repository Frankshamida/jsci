import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(request) {
  try {
    const { mode } = await request.json(); // 'login' or 'signup'
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Determine the redirect URL based on the request origin
    const origin = request.headers.get('origin') || 'http://localhost:3000';
    const redirectTo = `${origin}/auth/callback?mode=${mode || 'login'}`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      console.error('Google OAuth error:', error);
      return NextResponse.json(
        { success: false, message: 'Failed to initiate Google sign-in: ' + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, url: data.url });
  } catch (error) {
    console.error('Google auth error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error: ' + error.message },
      { status: 500 }
    );
  }
}
