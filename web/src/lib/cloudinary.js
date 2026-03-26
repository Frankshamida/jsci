import crypto from 'crypto';

// Sensible defaults to avoid oversized assets on the free plan
const DEFAULT_IMAGE_TRANSFORM = { width: 1200, quality: 'auto:good', format: 'auto', crop: 'limit' };
const DEFAULT_AUDIO_TRANSFORM = { quality: 'auto:eco', format: 'mp3', bitrate: '96k' };

function parseCloudinaryUrl(urlValue = '') {
  try {
    if (!urlValue) return null;
    const u = new URL(urlValue);
    if (u.protocol !== 'cloudinary:') return null;
    const cloudName = u.hostname;
    const apiKey = decodeURIComponent(u.username || '');
    const apiSecret = decodeURIComponent(u.password || '');
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
  } catch {
    return null;
  }
}

function getCloudNameOnly() {
  const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL || '');
  return process.env.CLOUDINARY_CLOUD_NAME || fromUrl?.cloudName || '';
}

export function getCloudinaryConfig() {
  const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL || '');
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || fromUrl?.cloudName;
  const apiKey = process.env.CLOUDINARY_API_KEY || fromUrl?.apiKey;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || fromUrl?.apiSecret;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET (or CLOUDINARY_URL).');
  }

  return { cloudName, apiKey, apiSecret };
}

function signParams(params, apiSecret) {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));

  const toSign = entries.map(([k, v]) => `${k}=${v}`).join('&');
  return crypto.createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}

function sanitizeBaseName(fileName = 'file') {
  return String(fileName)
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'file';
}

function normalizePublicId(publicId = '') {
  return String(publicId).replace(/^\/+/, '');
}

function buildTransformString(options = {}) {
  const { width, height, crop, gravity, quality, format, dpr, bitrate, flags } = options;
  const segments = [];
  if (width) segments.push(`w_${width}`);
  if (height) segments.push(`h_${height}`);
  if (crop) segments.push(`c_${crop}`);
  if (gravity) segments.push(`g_${gravity}`);
  if (dpr) segments.push(`dpr_${dpr}`);
  if (quality) segments.push(`q_${quality}`);
  if (format) segments.push(`f_${format}`);
  if (bitrate) segments.push(`br_${bitrate}`);
  if (Array.isArray(flags)) flags.filter(Boolean).forEach(f => segments.push(`fl_${f}`));
  return segments.length ? `${segments.join(',')}/` : '';
}

export function buildCloudinaryUrl(publicId, { resourceType = 'image', type = 'upload', ...transform } = {}) {
  const cloudName = getCloudNameOnly();
  if (!cloudName || !publicId) return null;
  const normalized = normalizePublicId(publicId);
  const transformStr = buildTransformString(transform);
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/${type}/${transformStr}${normalized}`;
}

export function buildCloudinaryImageUrl(publicId, overrides = {}) {
  return buildCloudinaryUrl(publicId, { resourceType: 'image', type: 'upload', ...DEFAULT_IMAGE_TRANSFORM, ...overrides });
}

export function buildCloudinaryAudioUrl(publicId, overrides = {}) {
  return buildCloudinaryUrl(publicId, {
    resourceType: 'video',
    type: 'upload',
    ...DEFAULT_AUDIO_TRANSFORM,
    ...overrides,
  });
}

export async function uploadBufferToCloudinary(arrayBuffer, { fileName, mimeType, folder = 'JSCI-System', resourceType = 'auto' } = {}) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();

  const timestamp = Math.floor(Date.now() / 1000);
  const baseName = sanitizeBaseName(fileName);
  const publicId = `${folder}/${Date.now()}_${baseName}`;

  const inferredType = (() => {
    if (resourceType !== 'auto') return resourceType;
    if (mimeType?.startsWith('audio') || mimeType?.startsWith('video')) return 'video';
    if (mimeType?.startsWith('image')) return 'image';
    return 'auto';
  })();

  const signPayload = { folder, public_id: publicId, timestamp };
  const signature = signParams(signPayload, apiSecret);

  const form = new FormData();
  form.append('file', new Blob([arrayBuffer], { type: mimeType || 'application/octet-stream' }), fileName || 'upload.bin');
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('signature', signature);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${inferredType}/upload`;
  const res = await fetch(uploadUrl, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || !json?.secure_url || !json?.public_id) {
    const msg = json?.error?.message || 'Cloudinary upload failed';
    throw new Error(msg);
  }

  return {
    id: json.public_id,
    publicId: json.public_id,
    secureUrl: json.secure_url,
    resourceType: json.resource_type || inferredType,
    format: json.format || null,
    bytes: json.bytes || 0,
  };
}

export async function deleteFromCloudinary(publicId, resourceType = 'image') {
  if (!publicId) return false;

  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const candidates = [resourceType, 'image', 'video', 'raw'].filter((v, i, arr) => v && arr.indexOf(v) === i);

  let lastError = null;
  for (const type of candidates) {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const signPayload = { invalidate: 'true', public_id: publicId, timestamp };
      const signature = signParams(signPayload, apiSecret);

      const form = new FormData();
      form.append('public_id', publicId);
      form.append('timestamp', String(timestamp));
      form.append('api_key', apiKey);
      form.append('invalidate', 'true');
      form.append('signature', signature);

      const destroyUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`;
      const res = await fetch(destroyUrl, { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));

      if (res.ok && (json?.result === 'ok' || json?.result === 'not found')) {
        return true;
      }

      lastError = new Error(json?.error?.message || `Cloudinary destroy failed for ${type}`);
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) throw lastError;
  return false;
}

export function isCloudinaryUrl(urlValue = '') {
  return typeof urlValue === 'string' && /res\.cloudinary\.com/i.test(urlValue);
}

export const cloudinaryDefaults = {
  image: DEFAULT_IMAGE_TRANSFORM,
  audio: DEFAULT_AUDIO_TRANSFORM,
};
