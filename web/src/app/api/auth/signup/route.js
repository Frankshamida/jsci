import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const body = await request.json();
    const { firstname, lastname, birthdate, email, password } = body;

    // Validate required fields
    if (!firstname || !lastname || !email || !password) {
      return NextResponse.json({ success: false, message: 'All required fields must be filled' }, { status: 400 });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, message: 'Please enter a valid email address' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (existing) {
      return NextResponse.json({ success: false, message: 'Email already registered. Please use another or login.' }, { status: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert new user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        birthdate: birthdate || null,
        ministry: null,
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        role: 'Guest',
        security_question: 'N/A',
        security_answer: 'N/A',
        status: 'Unverified',
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ success: false, message: 'Error creating account: ' + error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Account created successfully!',
      data: { memberId: newUser.member_id },
    });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
