import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch audit logs (Super Admin)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 100;
    const userId = searchParams.get('userId');
    const action = searchParams.get('action');

    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
    if (userId) query = query.eq('user_id', userId);
    if (action) query = query.eq('action', action);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Log an action
export async function POST(request) {
  try {
    const { userId, userName, action, resource, resourceId, details } = await request.json();

    const { data, error } = await supabase.from('audit_logs').insert({
      user_id: userId, user_name: userName, action, resource,
      resource_id: resourceId, details: details || {},
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
