import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getCloudinaryConfig } from '@/lib/cloudinary';
import { findEventActor, isEventManager } from '@/lib/eventCommittee';
import { SONG_PLAYLIST_FOLDER, SONG_COVER_TRANSFORM, SONG_AUDIO_EAGER } from '@/lib/songPlaylist';

// Signs a direct browser -> Cloudinary upload for the Song Playlist.
//
// POST { actorId, kind: 'cover' | 'audio', fileName }
//   -> { uploadUrl, fields }   the browser posts `fields` + `file` to uploadUrl
//
// Direct, because a song is easily bigger than the serverless request limit.
//
// Audio is signed with an eager, async transformation: Cloudinary makes the
// 64 kbps AAC rendition listeners stream right after the upload, once, instead of
// the first listener waiting for it to be made.

function sign(params, apiSecret) {
  const toSign = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return crypto.createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}

export async function POST(request) {
  try {
    const { actorId, kind, fileName } = await request.json();
    if (kind !== 'cover' && kind !== 'audio') {
      return NextResponse.json({ success: false, message: 'kind must be cover or audio' }, { status: 400 });
    }
    if (!isEventManager(await findEventActor(actorId))) {
      return NextResponse.json({ success: false, message: 'Only an Admin or Super Admin can do this.' }, { status: 403 });
    }

    const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
    const base = String(fileName || kind)
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 60) || kind;
    const params = {
      folder: `${SONG_PLAYLIST_FOLDER}/${kind === 'cover' ? 'covers' : 'audio'}`,
      public_id: `${Date.now()}_${base}`,
      timestamp: Math.floor(Date.now() / 1000),
      ...(kind === 'cover'
        ? { transformation: SONG_COVER_TRANSFORM }
        : { eager: SONG_AUDIO_EAGER, eager_async: 'true' }),
    };

    return NextResponse.json({
      success: true,
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${kind === 'cover' ? 'image' : 'video'}/upload`,
      fields: { ...params, api_key: apiKey, signature: sign(params, apiSecret) },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
