// The built-in poster templates: the gold card from the designer's files in
// public/News_Article_Template, written to the template contract (see
// lib/posterSvgSanitize.js) so every control works on them like on an
// imported template. One for a landscape photo, one for a portrait photo;
// the subtext is switched on or off in either.
//
// They are seeded into poster_templates (source 'builtin') by
// /api/news/poster-templates, which keeps them in step with this file. The
// logo is a file on the site; the editor embeds it when it draws.
//
// Everything is on the 1126 x 1408 canvas. The text block is centred in the
// band below the card (data-anchor="middle"), as in the designs.

const W = 1126;
const H = 1408;
const CARD = { x: 50, y: 188, w: 1026, h: 785 };
const PORTRAIT_W = (CARD.h * 9) / 16;
const PORTRAIT_X = W / 2 - PORTRAIT_W / 2;
const f = (n) => Number(n.toFixed(2));

function goldCard(key, family) {
  const portrait = family === 'portrait';
  const frame = portrait ? { x: f(PORTRAIT_X), y: CARD.y, w: f(PORTRAIT_W), h: CARD.h } : CARD;
  const backdrop = portrait ? `
  <g clip-path="url(#card-clip)">
   <image data-photo="backdrop" x="${CARD.x - 66}" y="${CARD.y - 66}" width="${CARD.w + 132}" height="${CARD.h + 132}" preserveAspectRatio="xMidYMid slice" opacity="0.7" filter="url(#card-blur)" href=""/>
   <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" fill="#FFF6E0" fill-opacity="0.15"/>
  </g>` : '';
  const edges = portrait
    ? `\n  <path d="M${frame.x} ${CARD.y}V${CARD.y + CARD.h}M${f(frame.x + frame.w)} ${CARD.y}V${CARD.y + CARD.h}" stroke="#EAA43A" stroke-opacity="0.6" stroke-width="2"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="poster" data-template="${key}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<style>.hl{fill:url(#grad-highlight)}#subtext .hl{fill:#FFFFFF}</style>
<linearGradient id="grad-background" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3D58E"/><stop offset="0.45" stop-color="#D9A441"/><stop offset="1" stop-color="#8A5A16"/></linearGradient>
<linearGradient id="grad-tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6E0" stop-opacity="0.35"/><stop offset="0.55" stop-color="#C98B2A" stop-opacity="0.25"/><stop offset="0.55" stop-color="#C98B2A" stop-opacity="0"/></linearGradient>
<linearGradient id="grad-overlay" gradientUnits="userSpaceOnUse" x1="0" y1="774.4" x2="0" y2="1408"><stop offset="0" stop-color="#C98B2A" stop-opacity="0.25"/><stop offset="0.378" stop-color="#6E4510" stop-opacity="0.7"/><stop offset="1" stop-color="#3E2606" stop-opacity="0.92"/></linearGradient>
<radialGradient id="grad-logo-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.45"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
<linearGradient id="grad-highlight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF3C4"/><stop offset="0.42" stop-color="#FFD25C"/><stop offset="0.52" stop-color="#E9A72E"/><stop offset="0.78" stop-color="#FFE39A"/><stop offset="1" stop-color="#F4BE4A"/></linearGradient>
<linearGradient id="grad-frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.5" stop-color="#F3C25A"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>
<filter id="bg-blur" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="card-blur" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="22"/></filter>
<filter id="card-shadow" x="-10%" y="-10%" width="120%" height="125%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#5A3A0A" flood-opacity="0.35"/></filter>
<filter id="text-shadow" x="-5%" y="-20%" width="110%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#000000" flood-opacity="0.4"/></filter>
<filter id="logo-shadow" x="-5%" y="-10%" width="110%" height="130%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#5A3608" flood-opacity="0.75"/><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#6E4510" flood-opacity="0.35"/></filter>
<clipPath id="card-clip"><rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="30"/></clipPath>
<clipPath id="canvas-clip"><rect width="${W}" height="${H}"/></clipPath>
</defs>
<g clip-path="url(#canvas-clip)">
 <rect id="layer-background" width="${W}" height="${H}" fill="url(#grad-background)"/>
 <image data-photo="background" x="-42" y="-42" width="${W + 84}" height="${H + 84}" preserveAspectRatio="xMidYMid slice" opacity="0.45" filter="url(#bg-blur)" href=""/>
 <rect id="layer-tint" width="${W}" height="${H}" fill="url(#grad-tint)"/>
 <rect id="layer-overlay" x="0" y="774.4" width="${W}" height="633.6" fill="url(#grad-overlay)"/>
 <ellipse id="layer-logo-glow" cx="563" cy="90" rx="560" ry="260" fill="url(#grad-logo-glow)"/>
 <g id="brand-logo" data-logo-area="113,14,900,160" filter="url(#logo-shadow)"><image x="398" y="14.25" width="330" height="159.5" preserveAspectRatio="xMidYMid meet" href="/Frames/Logo_Stamp.png"/></g>
 <g id="photo-card">
  <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="30" fill="#F3E2BC" filter="url(#card-shadow)"/>${backdrop}
  <g id="layer-photo"${portrait ? '' : ' clip-path="url(#card-clip)"'}>
   <rect id="photo-placeholder" x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="#EAD5A6"/>
   <image id="photo" data-photo="main" x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" preserveAspectRatio="xMidYMid slice" href=""/>
  </g>${edges}
  <rect x="53" y="191" width="1020" height="779" rx="27" fill="none" stroke="url(#grad-frame)" stroke-width="6"/>
 </g>
 <text id="photo-credit" x="1076" y="1005" text-anchor="end" font-family="Poppins, Arial, sans-serif" font-weight="500" font-size="20" fill="#FFFFFF" fill-opacity="0.9">PHOTO OF: NAME</text>
 <g id="text-block" data-anchor="middle" data-zone="1030,1300" data-subtext-gap="46">
  <text id="headline" x="563" text-anchor="middle" font-family="Outfit, Poppins, Arial, sans-serif" font-weight="800" font-size="68" fill="#FFFFFF" filter="url(#text-shadow)" data-max-lines="3" data-line-height="70.72" data-max-width="1000" data-min-size="44" data-transform="uppercase" data-highlight-preset="gold"><tspan id="headline-line-1" x="563" y="1150">YOUR <tspan class="hl">HEADLINE</tspan> HERE</tspan></text>
  <text id="subtext" x="563" text-anchor="middle" font-family="Poppins, Arial, sans-serif" font-weight="600" font-size="26" fill="#FCD877" data-max-lines="1" data-line-height="34" data-max-width="1000" data-min-size="16" data-optional="true" data-transform="uppercase"><tspan id="subtext-line-1" x="563" y="1196">DATE | PLACE</tspan></text>
 </g>
 <g id="footer" font-family="Poppins, Arial, sans-serif" font-weight="400" font-size="22" fill="#FFFFFF">
  <g id="footer-website"><g transform="translate(233.1,1345)"><g fill="none" stroke="#FFFFFF" stroke-width="2"><circle r="11.5"/><ellipse rx="5" ry="11.5"/><path d="M-11.5 0H11.5"/></g></g><text x="256.1" y="1352">jsci.vercel.app</text></g>
  <g id="footer-facebook"><g transform="translate(492.1,1345)"><g fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"><circle r="11.5"/><path d="M2 11V1H5.5M-2.5 1H5.5M2 1V-2.5C2 -5 3.5 -6 6 -6"/></g></g><text x="515.1" y="1352">facebook.com/CebuCityJoyfulSound</text></g>
 </g>
</g>
</svg>`;
}

export const BUILTIN_TEMPLATES = [
  { key: 'landscape', name: 'Gold card · landscape photo', family: 'landscape', svg: goldCard('landscape', 'landscape') },
  { key: 'portrait', name: 'Gold card · portrait photo', family: 'portrait', svg: goldCard('portrait', 'portrait') },
];

export const builtinTemplate = (key) => BUILTIN_TEMPLATES.find((t) => t.key === key) || null;

// The built-in gold card for a photo's shape.
export const builtinForFamily = (family) => BUILTIN_TEMPLATES.find((t) => t.family === family) || BUILTIN_TEMPLATES[0];
