// Event photos on Cloudinary. Server only (reads the Cloudinary secret).
//
// Photos go from the admin's browser straight to Cloudinary with a signature
// from our server, instead of through an API route: a day of event photos is
// hundreds of megabytes, and a Vercel function refuses a body over 4.5 MB.

import crypto from 'crypto';
import { buildCloudinaryUrl, getCloudinaryConfig } from '@/lib/cloudinary';

export const photoFolder = (eventId) => `JSCI-System/event-photos/${eventId}`;

/** Server cache key for an event's public photo list. */
export const photosCacheKey = (eventId) => `public:photos:${eventId}`;

// Stored at up to 6000px - the size of the camera's photos and of the frame -
// so a framed download is full resolution. (The browser keeps each file under
// the free plan's 10 MB limit before upload; see EventPhotosTab.jsx.)
const INCOMING = 'c_limit,w_6000,h_6000,q_auto:good';

// The frame laid over every downloaded photo: public/Frames/Frame_1.png,
// uploaded to Cloudinary by scripts/upload-photo-frame.mjs. 6000 x 4000, 3:2,
// transparent where the photo shows through.
const FRAME_ID = 'JSCI-System/frames/Frame_1';
const FRAME_W = 6000;
const FRAME_H = 4000;

const cloudName = () => process.env.CLOUDINARY_CLOUD_NAME
  || (process.env.CLOUDINARY_URL || '').match(/@([^/?#]+)/)?.[1] || '';

// The photo cropped to the frame's exact size (3:2, keeping the subject in
// view), then the frame stretched over it edge to edge - so it always fits,
// whatever size the photo came in at.
const framed = (width, height, delivery) => [
  `c_fill,g_auto,w_${width},h_${height}`,
  `l_${FRAME_ID.replace(/\//g, ':')},c_scale,fl_relative,w_1.0,h_1.0`,
  'fl_layer_apply,g_center',
  delivery,
].join('/');

// The two framed versions attendees get. Cloudinary builds a version the first
// time it is asked for - several seconds for a framed photo - so both are also
// requested as `eager` at upload (below): by the time anybody opens a photo it
// is already built and cached. The strings here and in the eager list must be
// identical, or the eager copy is a different image nobody asks for.
//   preview   1600 x 1067 WebP, ~200 KB - what the full-screen view shows
//   download  6000 x 4000 JPEG, the frame's own size
export const PREVIEW_T = framed(1600, 1067, 'q_auto,f_webp');
export const DOWNLOAD_T = framed(FRAME_W, FRAME_H, 'q_auto:good,f_jpg');

const urlFor = (publicId, transformation) => {
  const cloud = cloudName();
  if (!cloud || !publicId) return null;
  return `https://res.cloudinary.com/${cloud}/image/upload/${transformation}/${String(publicId).replace(/^\/+/, '')}`;
};

/** Everything the browser needs to upload one file to Cloudinary itself. */
export function signPhotoUpload(eventId) {
  const { cloudName: cloud, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    eager: `${PREVIEW_T}|${DOWNLOAD_T}`,
    eager_async: 'true',
    folder: photoFolder(eventId),
    timestamp,
    transformation: INCOMING,
  };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
    fields: { ...params, api_key: apiKey, signature },
  };
}

/**
 * Grid thumbnail (plain, small), the full view (framed, so what you see is
 * what you download), and the download: framed, 6000 x 4000 JPEG.
 */
export const photoUrls = (p) => ({
  thumb: buildCloudinaryUrl(p.public_id, { width: 400, height: 400, crop: 'fill', gravity: 'auto', quality: 'auto', format: 'auto' }) || p.url,
  full: urlFor(p.public_id, PREVIEW_T) || p.url,
  download: urlFor(p.public_id, DOWNLOAD_T) || p.url,
});
