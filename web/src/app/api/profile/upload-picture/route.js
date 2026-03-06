import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const email = formData.get('email');

    if (!file || !email) {
      return NextResponse.json({ success: false, message: 'File and email are required' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ success: false, message: 'Only JPEG, PNG, WebP, and GIF images are allowed' }, { status: 400 });
    }

    // Get user to build file path
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, member_id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    // Create unique filename
    const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
    const fileName = `${user.member_id || user.id}/avatar.${ext}`;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage using admin client (bypasses RLS)
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('profile')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ success: false, message: 'Error uploading image: ' + uploadError.message }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('profile')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // Update user's profile_picture in database
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ profile_picture: publicUrl })
      .eq('email', email.trim().toLowerCase());

    if (updateError) {
      return NextResponse.json({ success: false, message: 'Error updating profile picture URL' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Profile picture updated successfully!',
      url: publicUrl,
    });
  } catch (error) {
    console.error('Profile picture upload error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}
