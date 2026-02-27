import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch ministries
export async function GET() {
  try {
    const { data, error } = await supabase.from('ministries')
      .select('*').order('name', { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create ministry
export async function POST(request) {
  try {
    const { name, description, leaderId, leaderName } = await request.json();
    if (!name) return NextResponse.json({ success: false, message: 'Ministry name required' }, { status: 400 });

    const { data, error } = await supabase.from('ministries').insert({
      name, description, leader_id: leaderId || null, leader_name: leaderName || null,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Ministry created' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update ministry
export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const updateData = {};
    if (updates.name) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.leaderId !== undefined) { updateData.leader_id = updates.leaderId; updateData.leader_name = updates.leaderName; }
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

    const { data, error } = await supabase.from('ministries').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Ministry updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const { error } = await supabase.from('ministries').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Ministry deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
