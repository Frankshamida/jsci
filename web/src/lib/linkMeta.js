// What a link is: which platform, which icon, and a title a person can read.
//
// Joy shares links - the church's Facebook page, a YouTube channel, a sign-up
// form someone added to her knowledge - and a bare address is hard to read and
// harder to trust. So a link is shown as its platform's icon and a title
// ("Facebook · CebuCityJoyfulSound") rather than the raw URL. Used by the chat
// on the home page, by Joy's Knowledge in the dashboard, and by the server when
// it lists the church's links for Joy. No server-only imports here.

// Most specific first: m.me is Messenger, not Facebook.
const PLATFORMS = [
  { key: 'messenger', name: 'Messenger', icon: 'fab fa-facebook-messenger', hosts: ['m.me', 'messenger.com'] },
  { key: 'facebook', name: 'Facebook', icon: 'fab fa-facebook-f', hosts: ['facebook.com', 'fb.com', 'fb.me', 'fb.watch'] },
  { key: 'instagram', name: 'Instagram', icon: 'fab fa-instagram', hosts: ['instagram.com', 'instagr.am'] },
  { key: 'x', name: 'X', icon: 'fab fa-x-twitter', hosts: ['x.com', 'twitter.com'] },
  { key: 'youtube', name: 'YouTube', icon: 'fab fa-youtube', hosts: ['youtube.com', 'youtu.be'] },
  { key: 'tiktok', name: 'TikTok', icon: 'fab fa-tiktok', hosts: ['tiktok.com'] },
  { key: 'threads', name: 'Threads', icon: 'fab fa-threads', hosts: ['threads.net', 'threads.com'] },
  { key: 'linkedin', name: 'LinkedIn', icon: 'fab fa-linkedin-in', hosts: ['linkedin.com'] },
  { key: 'spotify', name: 'Spotify', icon: 'fab fa-spotify', hosts: ['spotify.com'] },
  { key: 'whatsapp', name: 'WhatsApp', icon: 'fab fa-whatsapp', hosts: ['wa.me', 'whatsapp.com'] },
  { key: 'viber', name: 'Viber', icon: 'fab fa-viber', hosts: ['viber.com', 'vb.me'] },
  { key: 'telegram', name: 'Telegram', icon: 'fab fa-telegram', hosts: ['t.me', 'telegram.me', 'telegram.org'] },
  { key: 'maps', name: 'Google Maps', icon: 'fas fa-location-dot', hosts: ['maps.app.goo.gl', 'maps.google.com'], paths: [['google.com', '/maps'], ['goo.gl', '/maps']] },
  { key: 'form', name: 'Google Form', icon: 'fas fa-clipboard-list', hosts: ['forms.gle'], paths: [['docs.google.com', '/forms']] },
  { key: 'drive', name: 'Google Drive', icon: 'fab fa-google-drive', hosts: ['drive.google.com'] },
  { key: 'gcash', name: 'GCash', icon: 'fas fa-wallet', hosts: ['gcash.com'] },
];

const WEBSITE = { key: 'web', name: 'Website', icon: 'fas fa-arrow-up-right-from-square' };
const EMAIL = { key: 'email', name: 'Email', icon: 'fas fa-envelope' };
const PHONE = { key: 'phone', name: 'Phone', icon: 'fas fa-phone' };

const hostMatches = (host, wanted) => host === wanted || host.endsWith(`.${wanted}`);

// A URL object for anything that looks like a link, or null. Only the schemes
// a visitor can safely be sent to: never javascript: or data:.
export const parseLink = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^mailto:/i.test(value) || /^tel:/i.test(value)) {
    try { return new URL(value); } catch { return null; }
  }
  const withScheme = /^https?:\/\//i.test(value) ? value : (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(value) ? `https://${value}` : null);
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
};

export const linkPlatform = (raw) => {
  const u = typeof raw === 'string' ? parseLink(raw) : raw;
  if (!u) return WEBSITE;
  if (u.protocol === 'mailto:') return EMAIL;
  if (u.protocol === 'tel:') return PHONE;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  for (const p of PLATFORMS) {
    if (p.hosts?.some((h) => hostMatches(host, h))) return p;
    if (p.paths?.some(([h, prefix]) => hostMatches(host, h) && path.startsWith(prefix))) return p;
  }
  return WEBSITE;
};

// The account a social link points at: facebook.com/CebuCityJoyfulSound ->
// "CebuCityJoyfulSound", youtube.com/@Church -> "@Church". Null for links
// that are not one account (a video, a search, a post).
const handleOf = (u, platform) => {
  const parts = u.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  const first = decodeURIComponent(parts[0]);
  if (['facebook', 'instagram', 'x', 'tiktok', 'threads', 'messenger', 'telegram'].includes(platform.key)) {
    if (/^(profile\.php|pages|groups|watch|share|p|reel|reels|status|i|intent|hashtag|explore|events)$/i.test(first)) {
      return platform.key === 'facebook' && /^groups$/i.test(first) && parts[1] ? decodeURIComponent(parts[1]) : null;
    }
    return first.replace(/^@?/, platform.key === 'tiktok' || platform.key === 'threads' ? '@' : '');
  }
  if (platform.key === 'youtube') {
    if (first.startsWith('@')) return first;
    if (/^(c|channel|user)$/i.test(first) && parts[1]) return decodeURIComponent(parts[1]);
    return null;
  }
  return null;
};

// A readable title for a link nobody gave a name to.
export const linkTitle = (raw) => {
  const u = typeof raw === 'string' ? parseLink(raw) : raw;
  if (!u) return String(raw || '');
  if (u.protocol === 'mailto:') return decodeURIComponent(u.pathname);
  if (u.protocol === 'tel:') return decodeURIComponent(u.pathname);
  const platform = linkPlatform(u);
  if (platform.key !== 'web') {
    const handle = handleOf(u, platform);
    return handle ? `${platform.name} · ${handle}` : platform.name;
  }
  return u.hostname.replace(/^www\./, '');
};

// Everything the chat needs to draw a link, or null when it is not one Joy may
// show. Relative paths ("/signup") stay on this site.
export const linkMeta = (raw, label) => {
  const value = String(raw || '').trim();
  if (value.startsWith('/') && !value.startsWith('//')) {
    return { href: value, title: label || value, icon: 'fas fa-arrow-right', key: 'site', external: false };
  }
  const u = parseLink(value);
  if (!u) return null;
  const platform = linkPlatform(u);
  return {
    href: u.href,
    title: (label && label.trim() && label.trim() !== value) ? label.trim() : linkTitle(u),
    icon: platform.icon,
    key: platform.key,
    platform: platform.name,
    external: /^https?:$/.test(u.protocol),
  };
};
