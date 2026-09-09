import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

// Signing up here creates an ordinary account in the SAME users table the main
// registration writes to - the person can sign in on the main site with it
// straight away, and on the committee portal as soon as an Admin adds them.
//
// It is deliberately not a second kind of user. The only thing this route does
// that /api/auth/signup does not is stamp `committee_requested_at`, which is
// what puts the person on the Team tab's waiting list.

async function stampRequest(userId) {
  // A missing column comes back as an `error` rather than a throw, so both are
  // checked. Either way the account is still made - the Admin just has to find
  // the person by name instead of seeing them on the waiting list.
  try {
    const { error } = await supabase
      .from('users')
      .update({ committee_requested_at: new Date().toISOString() })
      .eq('id', userId);
    return !error;
  } catch {
    return false;
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { firstname, lastname, birthdate, email, password } = body;

    if (!firstname || !lastname || !email || !password) {
      return NextResponse.json({ success: false, message: 'All required fields must be filled' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, message: 'Please enter a valid email address' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Already registered on the main site? That account IS the committee
    // account - there is nothing to create, so say so and point at the login
    // rather than refusing with "email taken", which reads like a dead end.
    const { data: existing } = await supabase
      .from('users')
      .select('id, is_event_committee, role')
      .eq('email', cleanEmail)
      .single();

    if (existing) {
      const alreadyIn = existing.is_event_committee === true || ['Admin', 'Super Admin'].includes(existing.role);
      if (!alreadyIn) await stampRequest(existing.id);
      return NextResponse.json({
        success: false,
        code: 'ACCOUNT_EXISTS',
        message: alreadyIn
          ? 'You already have an account and it is on the Event Committee. Just sign in with it.'
          : 'You already have an account from the main registration. Sign in with it here - an Admin has been asked to add you to the committee.',
      }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        birthdate: birthdate || null,
        ministry: null,
        email: cleanEmail,
        password: hashedPassword,
        role: 'Guest',
        security_question: 'N/A',
        security_answer: 'N/A',
        status: 'Unverified',
      })
      .select()
      .single();

    if (error) {
      console.error('Committee signup insert error:', error);
      return NextResponse.json({ success: false, message: 'Error creating account: ' + error.message }, { status: 500 });
    }

    const listed = await stampRequest(newUser.id);

    return NextResponse.json({
      success: true,
      message: 'Account created. An Admin needs to add you to the Event Committee before you can open the dashboard.',
      data: { memberId: newUser.member_id, onWaitingList: listed },
    });
  } catch (error) {
    console.error('Committee signup error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
