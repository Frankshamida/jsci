import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { STAFF_ROLES, requireRole } from '@/lib/actor';

// Writing announcements: Pastor, Admin and Super Admin - the roles that own
// Dashboard > Announcements management (lib/permissions SECTION_ACCESS). The
// author is the signed-in account, looked up here, not a name the browser sends.
const denied = (who) => NextResponse.json({ success: false, message: who.error }, { status: who.status });

// GET - Fetch announcements
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 50;

    const { data, error } = await supabase.from('announcements')
      .select('*').eq('is_active', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create announcement (Pastor, Admin, Super Admin)
export async function POST(request) {
  try {
    const { title, content, isPinned, actorId, author } = await request.json();
    const who = await requireRole(actorId || author, STAFF_ROLES);
    if (who.error) return denied(who);
    if (!title || !content) {
      return NextResponse.json({ success: false, message: 'Title and content required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('announcements').insert({
      title, content, author: who.user.id, author_name: who.name, is_pinned: isPinned || false,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Announcement created' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update announcement
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, actorId, ...updates } = body;
    const who = await requireRole(actorId, STAFF_ROLES);
    if (who.error) return denied(who);
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const updateData = {};
    if (updates.title) updateData.title = updates.title;
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.isPinned !== undefined) updateData.is_pinned = updates.isPinned;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

    const { data, error } = await supabase.from('announcements').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Announcement updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Delete announcement (soft)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const who = await requireRole(searchParams.get('actorId'), STAFF_ROLES);
    if (who.error) return denied(who);
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const { error } = await supabase.from('announcements').update({ is_active: false }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
