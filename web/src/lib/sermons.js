// Sermons - what the upload form, the list and /api/sermons share.
// Safe to import in the browser and on the server.

// Cloudinary's free plan takes raw files (PowerPoint, and PDFs kept as raw)
// up to 10 MB each.
export const SERMON_MAX_BYTES = 10 * 1024 * 1024;
export const SERMON_FORMATS = ['pdf', 'ppt', 'pptx'];
export const SERMON_ACCEPT = '.pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const SERMON_FOLDER = 'sermons';
export const SERMONS_MIGRATION_NOTE = 'Sermons need their database table: run supabase/migrations/sermons.sql in the Supabase SQL editor, then try again.';

// Who may read them: every signed-in account but a Guest (a Super Admin
// always may). The retired roles are members too.
export const SERMON_READERS = ['Church Member', 'Ministry Member', 'Pastor', 'Admin', 'Member', 'Song Leader', 'Leader'];
// Who may upload, edit and delete.
export const SERMON_EDITORS = ['Pastor'];

export const LIMITS = { title: 160, preacher: 120, passage: 120, summary: 2000 };

/** 'pdf' | 'ppt' | 'pptx' from a file name, or null. */
export function sermonFormat(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m && SERMON_FORMATS.includes(m[1]) ? m[1] : null;
}

export const formatLabel = (f) => (f === 'pdf' ? 'PDF' : 'PowerPoint');

/** "2.4 MB", "830 KB" */
export function sizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The file as a download (Cloudinary's attachment flag) rather than opened. */
export function downloadUrl(url) {
  return String(url || '').replace('/raw/upload/', '/raw/upload/fl_attachment/');
}

/** A PowerPoint opened in the browser, by Microsoft's free Office viewer. */
export function officeViewerUrl(url) {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
}
