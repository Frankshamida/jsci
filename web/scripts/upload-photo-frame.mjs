// Uploads a photo frame (public/Frames/*.png) to Cloudinary, where the event
// photo downloads lay it over each photo. See src/lib/eventPhotos.js.
//
//   node scripts/upload-photo-frame.mjs            -> public/Frames/Frame_1.png
//   node scripts/upload-photo-frame.mjs Frame_2    -> public/Frames/Frame_2.png
//
// Run it again after changing the frame: it overwrites the same Cloudinary id.
//
// The frame is 6000 x 4000 with transparency, which as a PNG is over the free
// plan's 10 MB limit - so it goes up as a high-quality WebP (alpha kept).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

const name = process.argv[2] || 'Frame_1';
const source = path.resolve('public/Frames', `${name}.png`);

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const cloud = env.CLOUDINARY_CLOUD_NAME;
const apiKey = env.CLOUDINARY_API_KEY;
const secret = env.CLOUDINARY_API_SECRET;
if (!cloud || !apiKey || !secret) throw new Error('Cloudinary is not configured in .env.local');

const image = sharp(source);
const { width, height } = await image.metadata();
let webp;
for (const quality of [95, 90, 85, 80]) {
  webp = await sharp(source).webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer();
  if (webp.length < 9.5 * 1024 * 1024) break;
}
console.log(`${name}: ${width}x${height}, ${(fs.statSync(source).size / 1048576).toFixed(1)} MB PNG -> ${(webp.length / 1048576).toFixed(1)} MB WebP`);

const params = {
  invalidate: 'true',
  overwrite: 'true',
  public_id: `JSCI-System/frames/${name}`,
  timestamp: Math.floor(Date.now() / 1000),
};
const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
const form = new FormData();
Object.entries(params).forEach(([k, v]) => form.append(k, String(v)));
form.append('api_key', apiKey);
form.append('signature', crypto.createHash('sha1').update(toSign + secret).digest('hex'));
form.append('file', new Blob([webp], { type: 'image/webp' }), `${name}.webp`);

const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
const json = await res.json();
if (!res.ok) throw new Error(json?.error?.message || `Upload failed (${res.status})`);
console.log(`Uploaded as ${json.public_id} (${json.width}x${json.height})`);
