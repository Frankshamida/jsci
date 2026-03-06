import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET - Fetch all permission controls (optionally filter by role)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');

    let query = supabaseAdmin.from('role_permissions_control').select('*').order('role').order('feature_key');
    if (role) query = query.eq('role', role);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Bulk upsert permission controls (SuperAdmin sets multiple toggles at once)
export async function POST(request) {
  try {
    const { controls, updatedBy } = await request.json();
    // controls = [{ role, feature_key, enabled }, ...]
    if (!controls || !Array.isArray(controls) || controls.length === 0) {
      return NextResponse.json({ success: false, message: 'Controls array required' }, { status: 400 });
    }

    const upsertData = controls.map((c) => ({
      role: c.role,
      feature_key: c.feature_key,
      enabled: c.enabled,
      updated_by: updatedBy || null,
    }));

    const { data, error } = await supabaseAdmin
      .from('role_permissions_control')
      .upsert(upsertData, { onConflict: 'role,feature_key' })
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Permissions updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Toggle a single permission
export async function PUT(request) {
  try {
    const { role, featureKey, enabled, updatedBy } = await request.json();
    if (!role || !featureKey) {
      return NextResponse.json({ success: false, message: 'Role and featureKey required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('role_permissions_control')
      .upsert({
        role,
        feature_key: featureKey,
        enabled: !!enabled,
        updated_by: updatedBy || null,
      }, { onConflict: 'role,feature_key' })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data, message: `${featureKey} ${enabled ? 'enabled' : 'disabled'} for ${role}` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Reset all permission overrides for a role (restore defaults)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    if (!role) {
      return NextResponse.json({ success: false, message: 'Role parameter required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('role_permissions_control')
      .delete()
      .eq('role', role);

    if (error) throw error;

    return NextResponse.json({ success: true, message: `All permission overrides reset for ${role}` });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
