import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { limit, tooManyRequests } from '@/lib/rateLimiter';
import bcrypt from 'bcryptjs';

// Changing a password needs the emailed code, checked here again - not only
// in /verify-otp. Without that, anyone could send an email address and a new
// password straight to this route and take over the account.
// password_resets has RLS on and no policies (supabase/migrations/security_lints.sql):
// only the server's service-role client can read or write it.

export async function POST(request) {
  try {
    const { email, newPassword, otp } = await request.json();

    if (!email || !newPassword || !otp) {
      return NextResponse.json({ success: false, message: 'Email, code and new password are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    // The same budget as /verify-otp, so the code cannot be guessed here instead.
    const attempt = await limit(`reset-password:${normalizedEmail}`, 5, 10 * 60 * 1000, { shared: true });
    if (!attempt.allowed) {
      return tooManyRequests(attempt.retryAfterSec, 'Too many attempts. Please wait a few minutes and request a new code.');
    }

    const { data: resetRecord } = await supabase
      .from('password_resets')
      .select('id, expires_at')
      .eq('email', normalizedEmail)
      .eq('otp', String(otp).trim())
      .maybeSingle();
    if (!resetRecord) {
      return NextResponse.json({ success: false, message: 'Invalid or used code. Please request a new one.' }, { status: 401 });
    }
    if (new Date(resetRecord.expires_at) < new Date()) {
      await supabase.from('password_resets').delete().eq('id', resetRecord.id);
      return NextResponse.json({ success: false, message: 'The code has expired. Please request a new one.' }, { status: 401 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const { error } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('email', email.trim().toLowerCase());

    if (error) {
      return NextResponse.json({ success: false, message: 'Error resetting password' }, { status: 500 });
    }

    // Clean up OTP records
    await supabase.from('password_resets').delete().eq('email', email.trim().toLowerCase());

    return NextResponse.json({ success: true, message: 'Password reset successfully!' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
