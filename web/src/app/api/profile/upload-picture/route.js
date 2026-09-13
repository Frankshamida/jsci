import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { uploadBufferToCloudinary, buildCloudinaryImageUrl, cloudinaryDefaults } from '@/lib/cloudinary';
import { hasPermission, MODULES } from '@/lib/permissions';

// Changing a profile picture, and - when the person wants it - telling the
// community they did.
//
// Two copies of the same photo are written, on purpose:
//
//   the avatar     Supabase storage, the small round one beside their name
//                  everywhere in the app.
//   the post image Cloudinary, a full-size asset of its own that the community
//                  post points at.
//
// They cannot be one file. An avatar is REPLACED every time somebody changes
// their picture, and a post has to keep showing the photo it was about - a
// shared file would quietly rewrite every "new profile picture" post in the
// feed the next time that person changed theirs.

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const BUCKET = 'profile';

// The feed asks Cloudinary for 1400px wide; the upload stores up to 1600. The
// photo in a post is therefore the picture as taken, not the 96px circle.
const POST_IMAGE_TRANSFORM = { ...cloudinaryDefaults.image, width: 1400 };

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const email = formData.get('email');
    // Opt-out rather than opt-in: the checkbox beside the crop is ticked by
    // default, and this is what it sends. Anything other than an explicit '1'
    // is read as "do not post" so an older client that knows nothing about
    // this cannot publish somebody's photo by accident.
    const shareToCommunity = formData.get('shareToCommunity') === '1';
    const caption = (formData.get('caption') || '').toString().trim().slice(0, 280);

    if (!file || !email) {
      return NextResponse.json({ success: false, message: 'File and email are required' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, message: 'Only JPEG, PNG, WebP, and GIF images are allowed' }, { status: 400 });
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, member_id, firstname, lastname, role, is_active, profile_picture')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    const ext = file.type.split('/')[1] === 'jpeg' ? 'jpg' : file.type.split('/')[1];
    const folder = user.member_id || user.id;
    // Stamped, not a fixed "avatar.jpg".
    //
    // The old path was overwritten in place, which meant the URL never changed
    // - so every browser and CDN that had already fetched it went on serving
    // the OLD picture. The person who changed it saw the new one, because the
    // client hung a ?t= cache-buster on its own copy, and nobody else did. A
    // new name per change means a new URL and the change lands everywhere at
    // once; the client no longer needs the cache-buster and no longer adds it.
    const fileName = `${folder}/avatar-${Date.now()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(fileName, buffer, { contentType: file.type, upsert: true });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ success: false, message: 'Error uploading image: ' + uploadError.message }, { status: 500 });
    }

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(fileName);
    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ profile_picture: publicUrl })
      .eq('id', user.id);

    if (updateError) {
      return NextResponse.json({ success: false, message: 'Error updating profile picture URL' }, { status: 500 });
    }

    // The one it replaced. Dropped only after the new row is saved, so a failed
    // clean-up can never leave an account pointing at a file that is gone.
    // Best effort: a stray object costs a few kilobytes, a blocked change costs
    // somebody their new picture.
    const previousPath = storagePathFromUrl(user.profile_picture, folder);
    if (previousPath && previousPath !== fileName) {
      try { await supabaseAdmin.storage.from(BUCKET).remove([previousPath]); } catch { /* non-fatal */ }
    }

    /* ---------------- The community post ---------------- */
    let post = null;
    let postSkipped = null;

    if (shareToCommunity) {
      // The same rule the compose box follows. Somebody who may not post to the
      // hub does not get to post to it by changing their picture, and an
      // account an Admin has deactivated does not post at all.
      if (user.is_active === false) {
        postSkipped = 'inactive';
      } else if (!hasPermission(user.role, MODULES.CREATE_POSTS)) {
        postSkipped = 'not-allowed';
      } else {
        try {
          post = await publishProfilePhotoPost({ user, arrayBuffer, mimeType: file.type, caption });
        } catch (postError) {
          // The picture IS changed by this point. A feed that did not get the
          // news is worth reporting, never worth undoing the change for.
          console.error('[upload-picture] community post failed:', postError?.message || postError);
          postSkipped = 'failed';
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: post ? 'Profile picture updated and shared!' : 'Profile picture updated successfully!',
      url: publicUrl,
      post,
      postSkipped,
    });
  } catch (error) {
    console.error('Profile picture upload error:', error);
    return NextResponse.json({ success: false, message: 'Server error: ' + error.message }, { status: 500 });
  }
}

// The object path inside the bucket, read back out of the public URL we stored.
// Scoped to the account's own folder so a malformed or foreign URL can never
// turn into a delete of somebody else's file.
function storagePathFromUrl(url, folder) {
  if (!url || !folder) return null;
  try {
    // The full public prefix, not just "/profile/". A member folder called
    // "profile" would make the short marker match in two places, and the one
    // it picked would decide which file got deleted.
    const marker = `/object/public/${BUCKET}/`;
    const at = String(url).indexOf(marker);
    if (at === -1) return null;
    const path = decodeURIComponent(String(url).slice(at + marker.length).split('?')[0]);
    return path.startsWith(`${folder}/`) ? path : null;
  } catch { return null; }
}

// One post, one image, wired to the same tables the compose box writes to - so
// it reacts, comments, opens in the viewer and can be deleted by its author
// exactly like any other post. Nothing about it is a special case in the feed.
async function publishProfilePhotoPost({ user, arrayBuffer, mimeType, caption }) {
  const authorName = `${user.firstname || ''} ${user.lastname || ''}`.trim() || 'A member';
  // Reads under the author's own name, which the card already prints above it:
  // "Frank Gomez / updated their profile picture 📸". A caption the person
  // typed replaces it - if they had something to say, that is the post.
  const content = caption || 'updated their profile picture 📸';

  const { data: postRow, error: postError } = await supabaseAdmin
    .from('community_posts')
    .insert({ author_id: user.id, author_name: authorName, content })
    .select()
    .single();
  if (postError) throw new Error(postError.message);

  try {
    const cloudinary = await uploadBufferToCloudinary(arrayBuffer, {
      fileName: `profile_${user.id}_${Date.now()}.jpg`,
      mimeType: mimeType || 'image/jpeg',
      folder: 'JSCI-System/community',
      resourceType: 'image',
    });

    const { data: imgRow, error: imgError } = await supabaseAdmin
      .from('community_post_images')
      .insert({
        post_id: postRow.id,
        google_drive_file_id: cloudinary.publicId,
        file_name: 'profile-picture.jpg',
        mime_type: mimeType || 'image/jpeg',
        file_size_bytes: arrayBuffer.byteLength,
        display_order: 0,
      })
      .select()
      .single();
    if (imgError) throw new Error(imgError.message);

    return {
      ...postRow,
      images: [{ ...imgRow, delivery_url: buildCloudinaryImageUrl(imgRow.google_drive_file_id, POST_IMAGE_TRANSFORM) }],
    };
  } catch (imageError) {
    // A post about a new picture with no picture on it is worse than no post.
    // The row is taken back out rather than left in the feed as a caption
    // floating on its own.
    try { await supabaseAdmin.from('community_posts').delete().eq('id', postRow.id); } catch { /* non-fatal */ }
    throw imageError;
  }
}
