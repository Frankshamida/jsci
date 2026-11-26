// Giving, on the server: the two tables (supabase/migrations/giving.sql), who
// may manage them, the campaigns and accounts shown to givers, a gift as its
// giver may see it, and the "your gift is confirmed" email.

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserRoles } from '@/lib/permissions';
import { cached, cacheInvalidate } from '@/lib/serverCache';
import { slugify } from '@/lib/serviceVideos';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';
import { absoluteUrl, siteOrigin } from '@/lib/socialCard';
import { sendEmail } from '@/lib/mailer';
import {
  campaignOpen, fundLabel, giftWhen, jarPath, methodLabel, peso, receiptPath, statusLabel, verseFor,
} from '@/lib/giving';

export const CAMPAIGNS = 'giving_campaigns';
export const GIFTS = 'giving_gifts';
export const GIVING_ROLES = ['Admin', 'Super Admin'];
export const GIVING_MIGRATION_NOTE = 'Giving needs its database tables: run supabase/migrations/giving.sql in the Supabase SQL editor, then try again.';

export const IMAGES_MIGRATION_NOTE = 'Photos need the updated table: run supabase/migrations/giving.sql again in the Supabase SQL editor (it is safe to run twice), then try again.';
export const MAX_IMAGES = 8;

// The tables are not there yet (the migration has not been run).
export const givingTablesMissing = (error) => {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''}`;
  return error.code === '42P01' || error.code === 'PGRST205' || (/giving_(gifts|campaigns)/.test(text) && /does not exist|schema cache|not find/i.test(text));
};

// An Admin or a Super Admin, as the main role or an additional one.
export async function givingAdmin(actorId) {
  if (!actorId) return { error: 'Not signed in.', status: 401 };
  const { data: user } = await supabaseAdmin
    .from('users').select('id, role, additional_roles, firstname, lastname, is_active')
    .eq('id', String(actorId)).maybeSingle();
  if (!user || user.is_active === false || !getUserRoles(user).some((r) => GIVING_ROLES.includes(r))) {
    return { error: 'Access denied. Only an Admin or Super Admin can manage giving.', status: 403 };
  }
  return { user, name: [user.firstname, user.lastname].filter(Boolean).join(' ') };
}

// ---- Numbers a gift is known by ----
// The secret in a giver's links: 24 characters, never guessed.
export const newToken = () => crypto.randomBytes(18).toString('base64url');
// What the giver and the treasurer quote: G-261126-7KQ4 (no 0/O or 1/I).
const RECEIPT_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newReceiptNo(at = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: '2-digit', month: '2-digit', day: '2-digit' }).format(at).replace(/-/g, '');
  const bytes = crypto.randomBytes(4);
  const tail = [...bytes].map((b) => RECEIPT_CHARS[b % RECEIPT_CHARS.length]).join('');
  return `G-${ymd}-${tail}`;
}

// ---- Text from a form ----
export const plain = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
export const note = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\r\n?/g, '\n')
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
export const cleanEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 200);
export const realDate = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100;
};

// "jo***@gmail.com": enough for the giver to recognise, on a receipt that may be passed around.
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!user || !domain) return '';
  return `${user.slice(0, Math.min(2, user.length))}${'*'.repeat(Math.max(1, Math.min(4, user.length - 2)))}@${domain}`;
}

// The photos column is not there yet (giving.sql not run again since it came).
export const noImagesColumn = (error) => !!error && (error.code === '42703' || error.code === 'PGRST204') && /images/.test(String(error.message || ''));

// A drive's photos: the images column, or, before it existed, its one picture.
export const campaignImages = (c) => {
  const list = Array.isArray(c?.images) ? c.images.filter(Boolean) : [];
  return list.length ? list.slice(0, MAX_IMAGES) : c?.image_url ? [c.image_url] : [];
};

// ---- Campaigns (the donation drives) ----
const RESERVED = new Set(['my', 'receipt', 'manage', 'new', 'admin']);
export async function allocateCampaignSlug(title, exceptId = null) {
  const s = slugify(title);
  const base = (s === 'service' && !/service/i.test(String(title))) || RESERVED.has(s) ? `${s === 'service' ? 'giving' : s}-appeal` : s;
  const { data } = await supabaseAdmin.from(CAMPAIGNS).select('id, slug').like('slug', `${base}%`);
  const taken = new Set((data || []).filter((r) => r.id !== exceptId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}

// What each campaign has raised: confirmed gifts only.
export async function campaignTotals(ids = null) {
  let q = supabaseAdmin.from(GIFTS).select('campaign_id, amount').eq('status', 'successful').not('campaign_id', 'is', null);
  if (ids) q = q.in('campaign_id', ids);
  const { data, error } = await q;
  if (error) throw error;
  const totals = {};
  (data || []).forEach((g) => {
    const t = (totals[g.campaign_id] ||= { raised: 0, gifts: 0 });
    t.raised += Number(g.amount) || 0;
    t.gifts += 1;
  });
  return totals;
}

export const publicCampaign = (c, totals = {}) => ({
  id: c.id,
  slug: c.slug,
  title: c.title,
  summary: c.summary || '',
  story: c.story || '',
  images: campaignImages(c),
  image_url: campaignImages(c)[0] || null,
  goal_amount: c.goal_amount != null ? Number(c.goal_amount) : null,
  ends_on: c.ends_on || null,
  is_featured: c.is_featured !== false,
  is_published: c.is_published !== false,
  raised: Math.round((totals[c.id]?.raised || 0) * 100) / 100,
  gifts: totals[c.id]?.gifts || 0,
});

// Every published campaign - ended ones too, so their pages keep working -
// newest first, featured first.
async function loadPublishedCampaigns() {
  const { data, error } = await supabaseAdmin.from(CAMPAIGNS).select('*').eq('is_published', true).order('created_at', { ascending: false });
  if (error) throw error;
  const totals = await campaignTotals((data || []).map((c) => c.id));
  return (data || []).map((c) => publicCampaign(c, totals))
    .sort((a, b) => Number(b.is_featured) - Number(a.is_featured));
}
const CAMPAIGNS_KEY = 'giving:campaigns';
export const publishedCampaigns = () => cached(CAMPAIGNS_KEY, 30_000, loadPublishedCampaigns);
// Still taking gifts.
export const openCampaigns = async () => (await publishedCampaigns()).filter(campaignOpen);
// Shown beside the News, in the Community Hub and on the home page.
export const featuredCampaigns = async () => (await openCampaigns()).filter((c) => c.is_featured);

// Never throws: a page without its campaigns still lets people give.
export async function safely(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}

// ---- Where to send it: the church's accounts in Mode of Payment ----
// Bank and online channels only - cash is given in person, not here.
async function loadMethods() {
  const { data, error } = await supabaseAdmin
    .from('payment_methods')
    .select('id, category, name, account_number, account_name, logo_url, qr_url, logo_color, notes, sort_order, created_at')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter((m) => m.category !== 'cash').map(({ sort_order: _s, created_at: _c, ...m }) => m);
}
const METHODS_KEY = 'giving:methods';
export const givingMethods = () => cached(METHODS_KEY, 60_000, loadMethods);

// One drive's jar as it is this moment - not cached - for the giver who has
// just opened the "your donation is confirmed" link.
export async function campaignNow(id) {
  if (!id) return null;
  const { data } = await supabaseAdmin.from(CAMPAIGNS).select('id, slug, title, goal_amount, is_published').eq('id', id).maybeSingle();
  if (!data) return null;
  const t = (await campaignTotals([id]))[id] || { raised: 0, gifts: 0 };
  return {
    slug: data.slug,
    title: data.title,
    goal_amount: data.goal_amount != null ? Number(data.goal_amount) : null,
    raised: Math.round(t.raised * 100) / 100,
    gifts: t.gifts,
    is_published: data.is_published !== false,
  };
}

// After a change: the donation pages at once; the News pages too when a drive
// changed (they show the featured one). Each server keeps its own short
// cache, so other places catch up within half a minute.
export function forgetGiving({ news = false } = {}) {
  cacheInvalidate(CAMPAIGNS_KEY);
  cacheInvalidate(METHODS_KEY);
  try {
    revalidatePath('/donation', 'layout');
    if (news) revalidatePath('/news', 'layout');
  } catch { /* outside a request */ }
}

// ---- A gift, as its giver may see it (the receipt, My giving, the jar) ----
export function giftView(g, { fullEmail = false } = {}) {
  return {
    receipt_no: g.receipt_no,
    token: g.token,
    amount: Number(g.amount) || 0,
    fund: g.fund,
    campaign_title: g.campaign_title || null,
    method_name: g.method_name,
    method_category: g.method_category || null,
    card_last4: g.card_last4 || null,
    reference_no: g.reference_no || null,
    status: g.status,
    status_note: g.status_note || null,
    given_at: g.given_at,
    confirmed_at: g.confirmed_at || null,
    refunded_at: g.refunded_at || null,
    donor_name: g.is_anonymous ? null : g.donor_name || null,
    is_anonymous: !!g.is_anonymous,
    donor_email: fullEmail ? g.donor_email || null : maskEmail(g.donor_email),
    has_account: !!g.user_id,
  };
}

export async function giftByToken(token) {
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(String(token))) return null;
  const { data, error } = await supabaseAdmin.from(GIFTS).select('*').eq('token', String(token)).maybeSingle();
  if (error) throw error;
  return data || null;
}

// ---- "Your gift is confirmed" ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function confirmedEmail(gift) {
  const brand = brandFor(await safely(readBranding, null));
  const origin = siteOrigin();
  // A donation's button goes back to its drive, where the giver's hearts drop
  // into the jar; a tithe or an offering's to its receipt.
  const drive = gift.campaign_id ? await safely(() => campaignNow(gift.campaign_id), null) : null;
  const jarUrl = drive?.is_published ? `${origin}${jarPath(drive.slug, gift.token)}` : null;
  const receiptUrl = `${origin}${receiptPath(gift.token)}`;
  const logo = absoluteUrl('/assets/LOGO.png', origin);
  const first = String(gift.is_anonymous ? '' : gift.donor_name || '').trim().split(/\s+/)[0];
  const verse = verseFor(gift.receipt_no);
  const when = giftWhen(gift.given_at);
  const rows = [
    ['Amount', peso(gift.amount)],
    ['For', fundLabel(gift)],
    ['Sent through', methodLabel(gift)],
    gift.reference_no ? ['Reference number', gift.reference_no] : null,
    ['Date and time', when],
    ['Receipt number', gift.receipt_no],
    ['Status', statusLabel(gift.status)],
  ].filter(Boolean);
  const isDonation = gift.fund === 'Donation';
  const subject = `Your ${isDonation ? 'donation' : 'gift'} of ${peso(gift.amount)} is confirmed. Thank you!`;
  const button = jarUrl
    ? { href: jarUrl, label: 'See your gift fill the jar' }
    : { href: receiptUrl, label: 'View your receipt' };
  // Only the message, no <html>/<body>: the EmailJS template places it
  // (as {{{html}}}) inside its own page, whichever editor it was saved in.
  const html = `<div style="margin:0;padding:0;background:#f6f3ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ec;padding:28px 12px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #ece6d8;">
<tr><td style="background:#16161f;padding:26px 28px;" align="left">
<img src="${esc(logo)}" width="44" height="44" alt="" style="vertical-align:middle;border:0;">
<span style="vertical-align:middle;margin-left:10px;color:#ffffff;font-size:17px;font-weight:700;">${esc(brand.church)}</span>
</td></tr>
<tr><td style="padding:30px 28px 6px;">
<p style="margin:0 0 6px;color:#926c15;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">${isDonation ? 'Donation' : 'Gift'} confirmed</p>
<h1 style="margin:0 0 12px;color:#1a1a2e;font-size:26px;line-height:1.25;">Thank you${first ? `, ${esc(first)}` : ''}!</h1>
<p style="margin:0;color:#4a4a57;font-size:16px;line-height:1.6;">We have received your ${isDonation ? 'donation' : 'gift'} of <strong style="color:#1a1a2e;">${esc(peso(gift.amount))}</strong> for <strong style="color:#1a1a2e;">${esc(gift.campaign_title || fundLabel(gift))}</strong>, sent on ${esc(when)}. It is confirmed${jarUrl ? ', and it is in the jar now' : ', and it is already at work in the ministry'}.</p>
</td></tr>
<tr><td style="padding:22px 28px 4px;" align="center">
<a href="${esc(button.href)}" style="display:inline-block;background:#ffc300;color:#1a1a2e;text-decoration:none;font-weight:700;font-size:16px;padding:14px 26px;border-radius:999px;">${esc(button.label)}</a>
</td></tr>
<tr><td style="padding:22px 28px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ece6d8;border-radius:12px;">
${rows.map(([k, v], i) => `<tr><td style="padding:11px 14px;${i ? 'border-top:1px solid #f0ebe0;' : ''}color:#6b6b76;font-size:14px;">${esc(k)}</td><td align="right" style="padding:11px 14px;${i ? 'border-top:1px solid #f0ebe0;' : ''}color:#1a1a2e;font-size:14px;font-weight:600;">${esc(v)}</td></tr>`).join('')}
</table>
${jarUrl ? `<p style="margin:12px 0 0;font-size:14px;"><a href="${esc(receiptUrl)}" style="color:#926c15;">View your receipt</a></p>` : ''}
</td></tr>
<tr><td style="padding:24px 28px 30px;">
<p style="margin:0;padding:16px 18px;background:#faf7f0;border-left:3px solid #ffc300;border-radius:8px;color:#4a4a57;font-size:15px;line-height:1.6;font-style:italic;">&ldquo;${esc(verse.text)}&rdquo;<br><span style="font-style:normal;font-weight:700;color:#926c15;font-size:13px;">${esc(verse.ref)}</span></p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #f0ebe0;color:#8a8a95;font-size:12px;line-height:1.6;">
You are getting this because a gift was sent to ${esc(brand.church)} with this email address. Keep the receipt number, ${esc(gift.receipt_no)}, if you ever need to ask us about this gift.
</td></tr>
</table>
</td></tr>
</table>
</div>`;
  const text = [
    `Thank you${first ? `, ${first}` : ''}!`,
    `Your gift of ${peso(gift.amount)} for ${fundLabel(gift)} (${when}) is confirmed.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    jarUrl ? `See your gift fill the jar: ${jarUrl}` : null,
    `Your receipt: ${receiptUrl}`,
    '',
    `"${verse.text}" - ${verse.ref}`,
  ].filter((l) => l !== null).join('\n');
  return { subject, html, text, fromName: brand.church };
}

// Sends it and notes when. { sent, reason? }
export async function sendConfirmedEmail(gift) {
  if (!gift?.donor_email) return { sent: false, reason: 'This gift has no email address.' };
  const mail = await confirmedEmail(gift);
  const result = await sendEmail({ to: gift.donor_email, ...mail });
  if (result.sent) {
    await supabaseAdmin.from(GIFTS).update({ email_sent_at: new Date().toISOString() }).eq('id', gift.id);
  }
  return result;
}

// What the login page keeps in the browser for a signed-in account.
export const sessionUser = (u) => ({
  id: u.id,
  memberId: u.member_id,
  firstname: u.firstname,
  lastname: u.lastname,
  email: u.email,
  birthdate: u.birthdate || null,
  life_verse: u.life_verse || null,
  ministry: u.ministry || null,
  sub_role: u.sub_role || null,
  role: u.role || 'Guest',
  additional_roles: u.additional_roles || [],
  default_dashboard: u.default_dashboard || null,
  status: u.status,
  isActive: u.is_active !== false,
  isGoogleUser: !!u.google_id,
  hasPassword: u.password !== 'GOOGLE_AUTH',
  profile_picture: u.profile_picture || null,
  allowed_event_types: u.allowed_event_types || [],
});

export async function logGiving(actor, action, resourceId, details) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: actor?.user?.id || null,
      user_name: actor?.name || 'System',
      action,
      resource: 'giving',
      resource_id: resourceId ? String(resourceId) : null,
      details: details || null,
    });
  } catch { /* non-fatal */ }
}
