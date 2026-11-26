// Giving - the words, numbers and links every giving screen shares:
// tithes and offerings (given on /sunday-service), the donation drives
// (/donation, each with its jar), the receipt, My giving, the guest's home,
// the cards beside the News and in the Community Hub, and Dashboard > Giving.
//
// Safe to import in the browser and on the server.

// What a gift is for. A campaign gift is a Donation, with the campaign named.
export const FUNDS = [
  { key: 'Tithes', label: 'Tithes', hint: 'The tenth we return to God' },
  { key: 'Offering', label: 'Offering', hint: 'A gift beyond the tithe' },
  { key: 'Donation', label: 'Donation', hint: 'For a cause or a need' },
];
export const isFund = (key) => FUNDS.some((f) => f.key === key);
// Given on the Sunday Service page. A Donation always goes to a drive.
export const TITHE_FUNDS = FUNDS.filter((f) => f.key !== 'Donation');

export const STATUSES = {
  pending: { label: 'Pending', tone: 'warn' },
  successful: { label: 'Successful', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  refunded: { label: 'Refunded', tone: 'off' },
};
export const statusLabel = (status) => STATUSES[status]?.label || 'Pending';

// The amounts offered as one tap; any other amount can be typed.
export const PRESET_AMOUNTS = [100, 500, 1000, 5000];
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 10_000_000;

// "₱1,500" - and "₱1,500.50" when there are centavos.
export function peso(n) {
  const v = Number(n) || 0;
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return `₱${v.toLocaleString('en-PH', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// What a typed amount is worth: "1,500", "₱ 1500.5" -> 1500.5; nonsense -> 0.
export function parseAmount(input) {
  const s = String(input ?? '').replace(/[₱,\s]/g, '').replace(/^php/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 0;
  return Math.round(Number(s) * 100) / 100;
}

// The fund as a giver reads it: "Donation · Typhoon Relief".
export const fundLabel = (gift) => (gift?.campaign_title ? `${gift.fund || 'Donation'} · ${gift.campaign_title}` : gift?.fund || 'Offering');

// Where the money went, as a giver reads it: "GCash", "BDO", "Card ending in 4242".
export function methodLabel(gift) {
  const name = String(gift?.method_name || '').trim() || 'Other';
  if (gift?.card_last4) return /card/i.test(name) ? `${name} ending in ${gift.card_last4}` : `${name} · card ending in ${gift.card_last4}`;
  return name;
}

// ---- Dates, in the church's own time ----
const TZ = 'Asia/Manila';
export function giftWhen(iso, { short = false } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-US', { timeZone: TZ, month: short ? 'short' : 'long', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}
export const giftDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }) : '');
export const giftTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '');
// "2026" for this year's total.
export const phYear = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(iso ? new Date(iso) : new Date());

// ---- Addresses ----
export const DONATION_PATH = '/donation';
// Tithes and offerings are given on the Sunday Service page, at its Give card.
export const TITHES_PATH = '/sunday-service#give';
export const MY_GIVING_PATH = '/giving/my';
export const campaignPath = (slug) => (slug ? `/donation/${encodeURIComponent(slug)}` : DONATION_PATH);
export const receiptPath = (token) => `/giving/receipt/${encodeURIComponent(token)}`;
// The link in the "your donation is confirmed" email: the drive's page, where
// the giver's hearts drop into its jar.
export const jarPath = (slug, token) => `${campaignPath(slug)}?gift=${encodeURIComponent(token)}`;

// ---- The jar ----
// What a drive's jar shows - the <heart-jar> element (public/heart-jar, put on
// the page by components/giving/GivingJar) - from the server's numbers, which
// count confirmed (Successful) donations only (givingServer campaignTotals):
//   with a goal     amount = pesos raised, toward the goal; past it the
//                   hearts spill over the top and onto the ground
//   without a goal  amount = how many donations; the jar fills more slowly
//                   the fuller it is, and is never quite full
// Any donation at all shows at least one heart.
export const JAR_SOFT_SCALE = 30;
export function jarProps(drive) {
  const goal = Number(drive?.goal_amount) || 0;
  if (goal > 0) return { amount: Math.max(0, Number(drive?.raised) || 0), goal };
  return { amount: Math.max(0, Number(drive?.gifts) || 0), goal: null, softScale: JAR_SOFT_SCALE };
}

// ---- A campaign's progress ----
export function campaignProgress(c) {
  const raised = Number(c?.raised) || 0;
  const goal = Number(c?.goal_amount) || 0;
  return { raised, goal, percent: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : null, gifts: Number(c?.gifts) || 0 };
}
// "Ends Dec 31" / "Ends today" / null; past campaigns are not shown publicly.
export function campaignEnds(c) {
  if (!c?.ends_on) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  if (c.ends_on === today) return 'Ends today';
  const d = new Date(`${c.ends_on}T00:00:00+08:00`);
  return `Ends ${d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })}`;
}
export function campaignOpen(c) {
  if (!c || c.is_published === false) return false;
  if (!c.ends_on) return true;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return c.ends_on >= today;
}

// ---- A verse for every thank-you ----
export const GIVING_VERSES = [
  { text: 'Each of you should give what you have decided in your heart to give, not reluctantly or under compulsion, for God loves a cheerful giver.', ref: '2 Corinthians 9:7' },
  { text: 'Give, and it will be given to you. A good measure, pressed down, shaken together and running over, will be poured into your lap.', ref: 'Luke 6:38' },
  { text: 'Honor the Lord with your wealth, with the firstfruits of all your crops; then your barns will be filled to overflowing.', ref: 'Proverbs 3:9-10' },
  { text: 'A generous person will prosper; whoever refreshes others will be refreshed.', ref: 'Proverbs 11:25' },
  { text: 'And my God will meet all your needs according to the riches of his glory in Christ Jesus.', ref: 'Philippians 4:19' },
  { text: 'It is more blessed to give than to receive.', ref: 'Acts 20:35' },
  { text: 'Bring the whole tithe into the storehouse. Test me in this, says the Lord Almighty, and see if I will not throw open the floodgates of heaven.', ref: 'Malachi 3:10' },
  { text: 'And do not forget to do good and to share with others, for with such sacrifices God is pleased.', ref: 'Hebrews 13:16' },
  { text: 'Whoever sows generously will also reap generously.', ref: '2 Corinthians 9:6' },
  { text: 'For where your treasure is, there your heart will be also.', ref: 'Matthew 6:21' },
];
// The same verse for the same gift, every time it is shown.
export function verseFor(seed = '') {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GIVING_VERSES[h % GIVING_VERSES.length];
}

// ---- The gifts this browser has sent, kept so they can be added to an
// account made or signed into later (see /api/giving/claim) ----
const TOKENS_KEY = 'jsci.giving.tokens';
export function rememberGift(token) {
  try {
    const list = JSON.parse(localStorage.getItem(TOKENS_KEY) || '[]').filter((t) => t !== token);
    localStorage.setItem(TOKENS_KEY, JSON.stringify([token, ...list].slice(0, 20)));
  } catch { /* not kept */ }
}
export function rememberedGifts() {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '[]').filter((t) => typeof t === 'string'); } catch { return []; }
}
export function forgetGifts(tokens) {
  try {
    const drop = new Set(tokens);
    const left = rememberedGifts().filter((t) => !drop.has(t));
    if (left.length) localStorage.setItem(TOKENS_KEY, JSON.stringify(left)); else localStorage.removeItem(TOKENS_KEY);
  } catch { /* nothing kept */ }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
