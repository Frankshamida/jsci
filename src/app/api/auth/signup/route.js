import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const body = await request.json();
    const { firstname, lastname, birthdate, ministry, username, password, securityQuestion, securityAnswer } = body;

    // Validate required fields
    if (!firstname || !lastname || !username || !password || !securityQuestion || !securityAnswer) {
      return NextResponse.json({ success: false, message: 'All required fields must be filled' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Check if username already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username.trim())
      .single();

    if (existing) {
      return NextResponse.json({ success: false, message: 'Username already taken. Please choose another.' }, { status: 409 });
    }

    // Hash password and security answer
    const hashedPassword = await bcrypt.hash(password, 12);
    const hashedAnswer = await bcrypt.hash(securityAnswer.trim().toLowerCase(), 12);

    // Insert new user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        birthdate: birthdate || null,
        ministry: ministry,
        username: username.trim(),
        password: hashedPassword,
        security_question: securityQuestion,
        security_answer: hashedAnswer,
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
