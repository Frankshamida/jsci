import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

// GET - Fetch ministries
export async function GET() {
  try {
    const client = supabaseAdmin || supabase;
    
    // Try lowercase first (standard)
    let { data, error } = await client.from('ministries').select('*').order('name', { ascending: true });
    
    // If empty or error, try Capitalized just in case the user's DB is case-sensitive
    if ((!data || data.length === 0) && !error) {
       console.log('[API Ministries] Lowercase table empty, trying Capitalized "Ministries"...');
       const { data: capData, error: capError } = await client.from('Ministries').select('*').order('name', { ascending: true });
       if (!capError && capData && capData.length > 0) {
         data = capData;
       }
    }

    if (error && !data) throw error;
    
    console.log(`[API Ministries] Successfully fetched ${data?.length || 0} ministries`);
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('[API Ministries] GET error:', error.message);
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
