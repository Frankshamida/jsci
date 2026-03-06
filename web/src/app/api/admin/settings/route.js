import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch system settings
export async function GET() {
  try {
    const { data, error } = await supabase.from('system_settings').select('*').order('key');
    if (error) throw error;

    const settings = {};
    data.forEach((s) => { settings[s.key] = s.value; });
    return NextResponse.json({ success: true, data: settings, raw: data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update setting
export async function PUT(request) {
  try {
    const { key, value, updatedBy } = await request.json();
    if (!key) return NextResponse.json({ success: false, message: 'Setting key required' }, { status: 400 });

    const { data, error } = await supabase.from('system_settings').upsert({
      key, value: JSON.stringify(value), updated_by: updatedBy,
    }, { onConflict: 'key' }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data, message: 'Setting updated' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
