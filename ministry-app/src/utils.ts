// Small helpers: dates, greetings, YouTube links, names.

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export const longDate = (s: string) => parseYmd(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
export const shortDate = (s: string) => parseYmd(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const weekday = (s: string) => parseYmd(s).toLocaleDateString('en-US', { weekday: 'short' });
export const dayOfMonth = (s: string) => parseYmd(s).getDate();
export const monthYear = (s: string) => parseYmd(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// "Today", "Tomorrow", "This Sunday", "In 9 days", "3 days ago"
export function relativeDay(s: string, today = ymd(new Date())): string {
  const days = Math.round((parseYmd(s).getTime() - parseYmd(today).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return `This ${parseYmd(s).toLocaleDateString('en-US', { weekday: 'long' })}`;
  if (days >= 7) return `In ${days} days`;
  return `${-days} days ago`;
}

// The next `count` Sundays from today (today included when it is one).
export function upcomingSundays(count: number): string[] {
  const d = new Date();
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  return Array.from({ length: count }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i * 7); return ymd(x); });
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const firstName = (name: string) => name.split(' ')[0] || name;

// The video id in any YouTube link (watch, youtu.be, shorts, embed, music), or null.
export function youtubeId(link: string): string | null {
  const m = String(link || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// YouTube's public thumbnail: an image link, no API key and no quota.
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

export const formatClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
};

export const formatBytes = (n: number | null | undefined) => {
  if (!n) return '';
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
};
