// A proof of payment is whatever the payer's bank or wallet gave them. That is
// usually a screenshot, but it is just as often an iPhone .heic, a PDF receipt
// emailed by the bank, or a photo in a format the phone chose on its own. All
// of it is accepted, so the pickers and the viewers have to be able to tell a
// picture from a document rather than assuming an <img> will render.

// What the file pickers offer. `image/*` is listed first so a phone still shows
// Camera / Photo Library at the top of the sheet, and the rest is there so a
// bank's PDF (or whatever else the payer actually has) can be chosen at all.
export const PROOF_ACCEPT = 'image/*,.heic,.heif,.pdf,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

// The ceiling is the hosting platform's, not ours: a serverless function will
// not accept a request body much over 4.5MB, and a file rejected up there comes
// back as a bare 413 with nothing to tell the payer what went wrong. So it is
// checked in the browser, where it can be explained.
//
// Photos are shrunk before this is measured (see shrinkProofImage), so in
// practice the limit only ever applies to a document.
export const PROOF_MAX_BYTES = 4 * 1024 * 1024;
export const PROOF_MAX_LABEL = '4MB';

export function isImageFile(file) {
  return !!file && String(file.type || '').startsWith('image/');
}

// Receipts are phone photos - often 3-5MB of JPEG for a picture of a screen.
// Re-encoding to WebP at a sane width cuts that to a couple of hundred KB
// before it ever leaves the browser, so uploads stay quick on mobile data and
// stay under the platform's body limit.
//
// Anything that cannot be decoded - a PDF, a .heic the browser has no decoder
// for, a document - is returned untouched. That fallback is what lets a format
// we cannot read still be uploaded as itself.
const MAX_RECEIPT_WIDTH = 1600;
export const shrinkProofImage = (file) => new Promise((resolve) => {
  if (!isImageFile(file) || typeof window === 'undefined') { resolve(file); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const scale = Math.min(1, MAX_RECEIPT_WIDTH / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        // Re-encoding that came out bigger is not worth keeping.
        if (!blob || blob.size >= file.size) { resolve(file); return; }
        const name = `${(file.name || 'receipt').replace(/\.[^.]+$/, '')}.webp`;
        resolve(new File([blob], name, { type: 'image/webp' }));
      }, 'image/webp', 0.82);
    } catch { URL.revokeObjectURL(url); resolve(file); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  img.src = url;
});

// ---- Reading a stored proof back ----
// Cloudinary serves what it cannot treat as an image from /raw/upload/, so the
// URL itself says which it is. The extension is the fallback for anything not
// served from Cloudinary.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|svg|heic|heif|jfif|pjpeg)(\?|#|$)/i;

export function isImageProof(url) {
  const u = String(url || '');
  if (!u) return false;
  if (/\/raw\/upload\//.test(u)) return false;
  if (/\.pdf(\?|#|$)/i.test(u)) return false;
  if (/\/image\/upload\//.test(u)) return true;
  return IMAGE_EXT.test(u);
}

export function isPdfProof(url) {
  return /\.pdf(\?|#|$)/i.test(String(url || ''));
}

// "Receipt.pdf" out of a Cloudinary public id, for the label on a file that
// cannot be shown inline.
export function proofFileName(url) {
  const u = String(url || '').split(/[?#]/)[0];
  const last = u.split('/').pop() || 'attachment';
  // Uploads are stored as "<timestamp>_<name>", so the timestamp is dropped.
  return decodeURIComponent(last).replace(/^\d{10,}_/, '') || 'attachment';
}
