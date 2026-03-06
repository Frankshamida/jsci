import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 });
    }

    // Check if user exists
    const { data: user, error } = await supabase
      .from('users')
      .select('id, firstname, email')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (error || !user) {
      return NextResponse.json({ success: false, message: 'No account found with this email' }, { status: 404 });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Store OTP in the database
    await supabase
      .from('password_resets')
      .delete()
      .eq('email', email.trim().toLowerCase());

    const { error: insertError } = await supabase
      .from('password_resets')
      .insert({
        email: email.trim().toLowerCase(),
        otp: otp,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error('Error storing OTP:', JSON.stringify(insertError));
      return NextResponse.json({ success: false, message: 'Error generating OTP: ' + insertError.message }, { status: 500 });
    }

    // Return OTP and user info so the client can send via EmailJS
    return NextResponse.json({
      success: true,
      message: 'OTP generated',
      otp: otp,
      firstname: user.firstname || 'User',
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
