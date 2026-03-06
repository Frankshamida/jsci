import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch roles
export async function GET() {
  try {
    const { data, error } = await supabase.from('roles').select('*').order('name');
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create role
export async function POST(request) {
  try {
    const { name, description, permissions } = await request.json();
    if (!name) return NextResponse.json({ success: false, message: 'Role name required' }, { status: 400 });

    const { data, error } = await supabase.from('roles').insert({
      name, description, permissions: JSON.stringify(permissions || []),
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Role created' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update role
export async function PUT(request) {
  try {
    const { id, name, description, permissions, isActive } = await request.json();
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (permissions) updateData.permissions = JSON.stringify(permissions);
    if (isActive !== undefined) updateData.is_active = isActive;

    const { data, error } = await supabase.from('roles').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Role updated' });
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

    const { error } = await supabase.from('roles').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Role deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
