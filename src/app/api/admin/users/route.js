import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

// GET - Fetch all users (Admin, Super Admin)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const ministry = searchParams.get('ministry');
    const status = searchParams.get('status');

    let query = supabase.from('users')
      .select('id, member_id, firstname, lastname, username, birthdate, ministry, role, status, is_active, last_login, created_at')
      .order('created_at', { ascending: false });

    if (role) query = query.eq('role', role);
    if (ministry) query = query.eq('ministry', ministry);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create user (Admin)
export async function POST(request) {
  try {
    const body = await request.json();
    const { firstname, lastname, username, password, ministry, role, securityQuestion, securityAnswer } = body;

    if (!firstname || !lastname || !username || !password) {
      return NextResponse.json({ success: false, message: 'Required fields missing' }, { status: 400 });
    }

    const { data: existing } = await supabase.from('users').select('id').eq('username', username.trim()).single();
    if (existing) {
      return NextResponse.json({ success: false, message: 'Username already exists' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const hashedAnswer = securityAnswer ? await bcrypt.hash(securityAnswer.trim().toLowerCase(), 12) : await bcrypt.hash('default', 12);

    const { data, error } = await supabase.from('users').insert({
      firstname: firstname.trim(), lastname: lastname.trim(),
      username: username.trim(), password: hashedPassword,
      ministry: ministry || 'Media', role: role || 'Member',
      security_question: securityQuestion || 'Default question',
      security_answer: hashedAnswer,
      status: 'Verified', is_active: true,
    }).select('id, member_id, firstname, lastname, username, ministry, role, status, is_active, created_at').single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'User created successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update user (Admin, Super Admin)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, action, ...updates } = body;

    if (!id) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    // Handle specific actions
    if (action === 'deactivate') {
      const { error } = await supabase.from('users').update({ is_active: false, status: 'Deactivated' }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'User deactivated' });
    }

    if (action === 'activate') {
      const { error } = await supabase.from('users').update({ is_active: true, status: 'Verified' }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'User activated' });
    }

    if (action === 'verify') {
      const { error } = await supabase.from('users').update({ status: 'Verified' }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'User verified' });
    }

    if (action === 'reset-password') {
      const newPassword = updates.newPassword || 'Password123!';
      const hashed = await bcrypt.hash(newPassword, 12);
      const { error } = await supabase.from('users').update({ password: hashed }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: 'Password reset successfully' });
    }

    if (action === 'assign-role') {
      const { error } = await supabase.from('users').update({ role: updates.role }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, message: `Role updated to ${updates.role}` });
    }

    // General update
    const updateData = {};
    if (updates.firstname) updateData.firstname = updates.firstname;
    if (updates.lastname) updateData.lastname = updates.lastname;
    if (updates.ministry) updateData.ministry = updates.ministry;
    if (updates.role) updateData.role = updates.role;
    if (updates.status) updateData.status = updates.status;

    const { data, error } = await supabase.from('users').update(updateData).eq('id', id)
      .select('id, member_id, firstname, lastname, username, ministry, role, status, is_active').single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'User updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Delete user (Super Admin only)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'User permanently deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
