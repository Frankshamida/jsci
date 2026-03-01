import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request) {
  try {
    const { email, otp } = await request.json();

    if (!email || !otp) {
      return NextResponse.json({ success: false, message: 'Email and OTP are required' }, { status: 400 });
    }

    // Look up the OTP
    const { data: resetRecord, error } = await supabase
      .from('password_resets')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .eq('otp', otp.trim())
      .single();

    if (error || !resetRecord) {
      return NextResponse.json({ success: false, message: 'Invalid OTP code' }, { status: 401 });
    }

    // Check expiration
    if (new Date(resetRecord.expires_at) < new Date()) {
      // Clean up expired OTP
      await supabase.from('password_resets').delete().eq('id', resetRecord.id);
      return NextResponse.json({ success: false, message: 'OTP has expired. Please request a new one.' }, { status: 401 });
    }

    return NextResponse.json({ success: true, message: 'OTP verified successfully' });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
