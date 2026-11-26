// A picture from the computer for News (the article editor and the poster
// editor), made small enough to upload - phone photos are often 5-10 MB -
// and sent to Cloudinary through our own API. Browser only.

export async function uploadNewsImage(file, actorId) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Use a JPG, PNG, WebP or GIF picture.');
  let blob = file;
  if (file.type !== 'image/gif' && file.size > 1.5 * 1024 * 1024) {
    const imageCompression = (await import('browser-image-compression')).default;
    blob = await imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 2000, useWebWorker: true });
  }
  const form = new FormData();
  form.append('actorId', actorId);
  form.append('file', blob, file.name || 'news-image.jpg');
  const res = await fetch('/api/news/upload', { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.message || 'The picture could not be uploaded.');
  return { url: json.data.url, publicId: json.data.publicId, caption: '', alt: '' };
}

// A logo for a poster: a transparent PNG (or WebP) or an SVG, at most 2 MB,
// uploaded as it is.
export async function uploadPosterLogo(file, actorId) {
  if (!/^image\/(png|webp|svg\+xml)$/.test(file.type)) throw new Error('Use a PNG or SVG logo with a transparent background.');
  if (file.size > 2 * 1024 * 1024) throw new Error('That logo is larger than 2 MB. Use a smaller file.');
  const form = new FormData();
  form.append('actorId', actorId);
  form.append('kind', 'logo');
  form.append('file', file, file.name || 'logo.png');
  const res = await fetch('/api/news/upload', { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.message || 'The logo could not be uploaded.');
  return { url: json.data.url, publicId: json.data.publicId };
}
