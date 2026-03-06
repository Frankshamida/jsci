import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch excuses
// ?userId=xxx -> own excuses (song leader)
// ?all=true -> all excuses (admin)
// ?status=Pending -> filter by status
// ?date=2026-03-08 -> excuses for a specific date
// ?roleType=Song Leader -> filter by role type
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const all = searchParams.get('all');
    const status = searchParams.get('status');
    const date = searchParams.get('date');
    const roleType = searchParams.get('roleType');

    let query = supabase.from('lineup_excuses').select('*').order('created_at', { ascending: false });

    if (userId && !all) {
      query = query.eq('user_id', userId);
    }
    if (status) {
      query = query.eq('status', status);
    }
    if (date) {
      query = query.eq('excuse_date', date);
    }
    if (roleType) {
      query = query.eq('role_type', roleType);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create a new excuse
export async function POST(request) {
  try {
    const body = await request.json();
    const { userId, userName, excuseDate, reason, roleType, profilePicture } = body;

    if (!userId || !excuseDate || !reason) {
      return NextResponse.json({ success: false, message: 'User ID, date, and reason are required' }, { status: 400 });
    }

    const role = roleType || 'Song Leader';

    // Check if excuse already exists for this user, date & role
    const { data: existing } = await supabase
      .from('lineup_excuses')
      .select('id')
      .eq('user_id', userId)
      .eq('excuse_date', excuseDate)
      .eq('role_type', role)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: false, message: 'You already have an excuse for this date and role' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('lineup_excuses')
      .insert({
        user_id: userId,
        user_name: userName,
        excuse_date: excuseDate,
        reason: reason,
        status: 'Pending',
        role_type: role,
        profile_picture: profilePicture || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Excuse submitted! Waiting for admin approval.', data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Approve/Reject excuse (Admin) or update excuse (Song Leader)
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, status, adminNote, reviewedBy } = body;

    if (!id || !status) {
      return NextResponse.json({ success: false, message: 'Excuse ID and status are required' }, { status: 400 });
    }

    const updateData = { status };
    if (adminNote !== undefined) updateData.admin_note = adminNote;
    if (reviewedBy) updateData.reviewed_by = reviewedBy;

    const { error } = await supabase
      .from('lineup_excuses')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    const action = status === 'Approved' ? 'approved' : status === 'Rejected' ? 'rejected' : 'updated';
    return NextResponse.json({ success: true, message: `Excuse ${action} successfully!` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Cancel/delete an excuse
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: 'Excuse ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('lineup_excuses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Excuse cancelled successfully!' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
