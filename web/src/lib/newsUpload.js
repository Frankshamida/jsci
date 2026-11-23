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
