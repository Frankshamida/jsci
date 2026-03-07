import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST — Handle Google auth callback from mobile app
// Mobile sends: { googleId, email, firstname, lastname, avatarUrl }
// We find or create the user in our users table and return user data
export async function POST(request) {
  try {
    const { googleId, email, firstname, lastname, avatarUrl } = await request.json();

    if (!googleId || !email) {
      return NextResponse.json(
        { success: false, message: 'Google ID and email are required' },
        { status: 400 }
      );
    }

    // Step 1: Check if user exists by google_id
    let { data: existingUser, error: lookupError } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single();

    // Step 2: If not found by google_id, try by email (existing account linking)
    if (!existingUser) {
      const { data: emailUser } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (emailUser) {
        // Link google_id to existing account
        await supabase
          .from('users')
          .update({ google_id: googleId, profile_picture: avatarUrl || emailUser.profile_picture })
          .eq('id', emailUser.id);

        existingUser = { ...emailUser, google_id: googleId };
      }
    }

    if (existingUser) {
      // User exists — check if active
      if (existingUser.is_active === false) {
        return NextResponse.json(
          { success: false, message: 'Account has been deactivated. Please contact admin.' },
          { status: 403 }
        );
      }

      // Update last login & sync profile picture
      const updateFields = { last_login: new Date().toISOString() };
      if (avatarUrl) updateFields.profile_picture = avatarUrl;
      if (firstname && !existingUser.firstname) updateFields.firstname = firstname;
      if (lastname && !existingUser.lastname) updateFields.lastname = lastname;
      await supabase.from('users').update(updateFields).eq('id', existingUser.id);

      const userData = {
        id: existingUser.id,
        memberId: existingUser.member_id,
        firstname: existingUser.firstname || firstname,
        lastname: existingUser.lastname || lastname,
        email: existingUser.email,
        birthdate: existingUser.birthdate,
        life_verse: existingUser.life_verse || null,
        ministry: existingUser.ministry,
        sub_role: existingUser.sub_role || null,
        role: existingUser.role || 'Guest',
        status: existingUser.status,
        isActive: existingUser.is_active !== false,
        isGoogleUser: true,
        hasPassword: existingUser.password !== 'GOOGLE_AUTH',
        profile_picture: avatarUrl || existingUser.profile_picture || null,
        phone: existingUser.phone || null,
        allowed_event_types: existingUser.allowed_event_types || [],
      };

      return NextResponse.json({ success: true, data: userData });
    }

    // Step 3: No existing user — create new user (auto-signup via Google)
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        firstname: firstname || '',
        lastname: lastname || '',
        google_id: googleId,
        email: email,
        password: 'GOOGLE_AUTH',
        role: 'Guest',
        security_question: 'Google Account',
        security_answer: 'GOOGLE_AUTH',
        status: 'Unverified',
        profile_picture: avatarUrl || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating Google user:', insertError);
      return NextResponse.json(
        { success: false, message: 'Failed to create account: ' + insertError.message },
        { status: 500 }
      );
    }

    const userData = {
      id: newUser.id,
      memberId: newUser.member_id,
      firstname: newUser.firstname,
      lastname: newUser.lastname,
      email: newUser.email,
      birthdate: newUser.birthdate,
      life_verse: newUser.life_verse || null,
      ministry: newUser.ministry,
      sub_role: newUser.sub_role || null,
      role: newUser.role || 'Guest',
      status: newUser.status,
      isActive: newUser.is_active !== false,
      isGoogleUser: true,
      hasPassword: false,
      profile_picture: avatarUrl || null,
      phone: null,
      allowed_event_types: newUser.allowed_event_types || [],
    };

    return NextResponse.json({ success: true, data: userData });
  } catch (error) {
    console.error('Google mobile auth error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error: ' + error.message },
      { status: 500 }
    );
  }
}
