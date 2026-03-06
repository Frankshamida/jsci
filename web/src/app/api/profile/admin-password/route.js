import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// POST - Set or update admin access password
export async function POST(request) {
  try {
    const { userId, password } = await request.json();
    if (!userId || !password) {
      return NextResponse.json({ success: false, message: 'User ID and password required' }, { status: 400 });
    }
    if (password.length < 4) {
      return NextResponse.json({ success: false, message: 'Password must be at least 4 characters' }, { status: 400 });
    }

    const hashed = hashPassword(password);
    const { error } = await supabaseAdmin
      .from('users')
      .update({ admin_access_password: hashed })
      .eq('id', userId);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Admin access password set successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Verify admin access password
export async function PUT(request) {
  try {
    const { userId, password } = await request.json();
    if (!userId || !password) {
      return NextResponse.json({ success: false, message: 'User ID and password required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('admin_access_password')
      .eq('id', userId)
      .single();

    if (error) throw error;

    if (!data.admin_access_password) {
      return NextResponse.json({ success: false, message: 'No admin access password set. Please set one in My Profile first.', noPassword: true }, { status: 403 });
    }

    const hashed = hashPassword(password);
    if (hashed !== data.admin_access_password) {
      return NextResponse.json({ success: false, message: 'Incorrect password' }, { status: 401 });
    }

    return NextResponse.json({ success: true, message: 'Password verified' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// GET - Check if admin has set an access password
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ success: false, message: 'User ID required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .select('admin_access_password')
      .eq('id', userId)
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, hasPassword: !!data.admin_access_password });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
