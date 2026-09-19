// Event posters, sized for the screen they are actually shown on.
//
// A poster is uploaded as artwork - the two on the site right now are 724 KB
// PNGs - and the public page was handing that whole file to an <img> that
// displays it 440 CSS pixels wide. Every visitor paid for a print-quality
// poster per event to look at a thumbnail, which on mobile data is most of the
// wait before the events section appears.
//
// Cloudinary resizes on delivery, so the fix is in the URL:
//
//   f_auto  - WebP or AVIF to a browser that takes them, the original otherwise
//   q_auto  - quality chosen per image rather than a fixed number
//   c_limit - scale down to fit the width, never up, never cropped
//
// At 440px that same poster is 23 KB. The artwork is untouched; only what
// travels changes.
//
// (lib/socialCard.js builds a different transformation of the same posters -
// the 1200x630 card for link previews. Both read the URL the same way.)

const CLOUDINARY_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i;

// The poster at a given width. Anything not on Cloudinary - an image pasted in
// by hand, a local file - is returned untouched rather than guessed at.
export const eventImageUrl = (url, width) => {
  const value = String(url || '');
  const parts = value.match(CLOUDINARY_UPLOAD);
  if (!parts) return value;
  return `${parts[1]}f_auto,q_auto,w_${width},c_limit/${parts[2]}`;
};

// The card is never wider than 440 CSS px (.hp-invite-card caps it), so these
// cover it at 1x, 1.5x and 2x. The browser picks one knowing the screen's
// density and the `sizes` hint below - a phone takes the 440, a retina laptop
// the 880, and neither downloads the other.
export const EVENT_IMAGE_WIDTHS = [440, 660, 880];

// "...440 440w, ...660 660w, ...880 880w"
export const eventImageSrcSet = (url, widths = EVENT_IMAGE_WIDTHS) => {
  if (!url || !CLOUDINARY_UPLOAD.test(String(url))) return undefined;
  return widths.map((w) => `${eventImageUrl(url, w)} ${w}w`).join(', ');
};

// How wide the poster will be drawn, which is what lets the browser choose from
// the set above before any layout has happened. Below 480px the card spans the
// viewport; above it the card's own cap applies.
export const EVENT_IMAGE_SIZES = '(max-width: 480px) 100vw, 440px';
