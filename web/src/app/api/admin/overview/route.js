import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/actor';
import { getUserRoles } from '@/lib/permissions';
import { churchDate, addDays } from '@/lib/ministryApp';
import { loadCare } from '@/lib/joyfulCaresServer';

export const dynamic = 'force-dynamic';
// Every read fresh: force-dynamic alone does not keep Next 14 from caching the
// database reads of a GET-only route.
export const revalidate = 0;

// ============================================================
// GET /api/admin/overview?actorId=..
// Everything the Admin and Super Admin Home shows (components/admin/
// AdminOverview), in one request:
//   attention   accounts to verify, event payments to check, gifts to
//               confirm, new ISOM inquiries
//   members     accounts by role, verified or waiting, new each month
//   attendance  people checked in on each of the last 52 Sundays
//   ministries  each ministry's Sunday attendance (Joyful Cares' numbers)
//   events      upcoming events' registrations, by payment
//   giving      confirmed gifts by month, by fund
//   system      the activity log (Super Admin only)
// Admins only (a Super Admin always may). Each part is read on its own, so a
// table that is missing or failing empties its card instead of the page.
// ============================================================

const HERE = ['Present', 'Late'];
const SUNDAYS = 52;
const MONTHS = 12;
// PostgREST returns at most 1000 rows a request; longer reads go in pages.
const PAGE = 1000;

// How a registration stands, as the office acts on it.
const PAY_BUCKETS = {
  payment_verified: 'paid',
  registered: 'paid', // a free event: nothing to pay
  payment_submitted: 'check', // proof sent, waiting on an admin
  pending_cash: 'cash', // to pay in cash at the desk
  paid_pending_turnover: 'turnover', // paid to someone who has not turned it over
  installment: 'unpaid',
  pending_payment: 'unpaid',
};

const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const monthOf = (ts) => churchDate(new Date(ts)).slice(0, 7);
// Midnight in Manila, as a UTC timestamp.
const manilaMidnight = (ymd) => new Date(`${ymd}T00:00:00+08:00`).toISOString();

// The last `n` months as 'YYYY-MM', oldest first, ending with this one.
function lastMonths(today, n) {
  const [y, m] = today.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

// Every row a query gives, a page at a time. `build` makes a fresh query.
async function readAll(build) {
  const rows = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// A card's data, or null when its read fails.
async function part(name, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`admin overview: ${name}:`, error?.message || error);
    return null;
  }
}

async function headCount(build) {
  const { count, error } = await build();
  if (error) throw error;
  return count || 0;
}

// ---- Accounts ----
function roleGroup(user) {
  const roles = getUserRoles(user);
  if (roles.includes('Super Admin') || roles.includes('Admin')) return 'staff';
  if (roles.includes('Pastor')) return 'pastors';
  if (roles.some((r) => ['Ministry Member', 'Song Leader', 'Leader'].includes(r))) return 'ministry';
  if (roles.some((r) => ['Church Member', 'Member'].includes(r))) return 'staff';
  return 'guests';
}
const ROLE_GROUPS = [
  ['guests', 'Guests'],
  ['ministry', 'Ministry members'],
  ['pastors', 'Pastors'],
  ['staff', 'Members and staff'],
];

async function membersPart(today, months) {
  const users = await readAll(() => supabaseAdmin
    .from('users').select('id, role, additional_roles, status, is_active, created_at')
    .neq('is_active', false).order('id'));
  const verified = users.filter((u) => u.status === 'Verified').length;
  const thisMonth = today.slice(0, 7);
  const byMonth = new Map(months.map((m) => [m, 0]));
  let before = 0; // accounts made before the first month shown
  users.forEach((u) => {
    if (!u.created_at) { before += 1; return; }
    const m = monthOf(u.created_at);
    if (byMonth.has(m)) byMonth.set(m, byMonth.get(m) + 1);
    else if (m < months[0]) before += 1;
  });
  const groups = Object.fromEntries(ROLE_GROUPS.map(([k]) => [k, 0]));
  users.forEach((u) => { groups[roleGroup(u)] += 1; });
  let running = before;
  return {
    total: users.length,
    verified,
    waiting: users.length - verified,
    newThisMonth: byMonth.get(thisMonth) || 0,
    byRole: ROLE_GROUPS.map(([key, label]) => ({ key, label, count: groups[key] })),
    signups: months.map((m) => ({ month: m, count: byMonth.get(m) })),
    // Accounts there were at the end of each month (for the figure's line).
    totals: months.map((m) => { running += byMonth.get(m); return { month: m, count: running }; }),
  };
}

// ---- Check-ins on each of the last 52 Sundays ----
async function attendancePart(lastSunday) {
  const sundays = Array.from({ length: SUNDAYS }, (_, i) => addDays(lastSunday, -7 * (SUNDAYS - 1 - i)));
  const rows = await readAll(() => supabaseAdmin
    .from('attendance').select('id, user_id, event_date, status')
    .in('event_date', sundays).in('status', HERE).order('id'));
  const bySunday = new Map(sundays.map((d) => [d, new Set()]));
  rows.forEach((r) => { if (r.user_id) bySunday.get(r.event_date)?.add(r.user_id); });
  return { weeks: sundays.map((d) => ({ date: d, count: bySunday.get(d).size })) };
}

// ---- Each ministry's Sunday attendance (Joyful Cares' figures) ----
async function ministriesPart() {
  const data = await loadCare();
  return (data.ministries || []).map((m) => ({
    key: m.key, title: m.title, members: m.members,
    rate: m.rate8 == null ? null : Math.round(m.rate8 * 100),
    prev: m.ratePrev == null ? null : Math.round(m.ratePrev * 100),
  }));
}

// ---- Event registrations, by payment ----
async function eventsPart(today) {
  const since = manilaMidnight(addDays(today, -30));
  const now = Date.now();
  const { data, error } = await supabaseAdmin
    .from('events').select('id, title, event_date, end_date, is_active, registration_required')
    .or(`event_date.gte."${since}",end_date.gte."${since}"`)
    .order('event_date', { ascending: true }).limit(60);
  if (error) throw error;
  // Recent ones too: cash and turnover are still collected after the day.
  const events = (data || []).filter((e) => e.is_active !== false && e.registration_required !== false);
  const ids = events.map((e) => e.id);
  const regs = ids.length ? await readAll(() => supabaseAdmin
    .from('event_registrations').select('id, event_id, status')
    .in('event_id', ids).is('deleted_at', null).neq('status', 'cancelled').order('id')) : [];

  const empty = () => ({ paid: 0, check: 0, cash: 0, turnover: 0, unpaid: 0 });
  const byEvent = new Map(ids.map((id) => [id, empty()]));
  regs.forEach((r) => {
    const b = byEvent.get(r.event_id);
    const k = PAY_BUCKETS[r.status];
    if (b && k) b[k] += 1;
  });
  const sum = (b) => b.paid + b.check + b.cash + b.turnover + b.unpaid;
  const owed = { check: 0, cash: 0, turnover: 0 };
  byEvent.forEach((b) => { owed.check += b.check; owed.cash += b.cash; owed.turnover += b.turnover; });

  const upcoming = events.filter((e) => Date.parse(e.end_date || e.event_date) >= now);
  const shown = upcoming.slice(0, 6).map((e) => {
    const b = byEvent.get(e.id);
    return { id: e.id, title: e.title, at: e.event_date, endsAt: e.end_date || null, ...b, total: sum(b) };
  });
  const upcomingTotals = upcoming.reduce((acc, e) => {
    const b = byEvent.get(e.id);
    acc.total += sum(b);
    acc.paid += b.paid + b.turnover; // paid, as far as the attendee goes
    return acc;
  }, { total: 0, paid: 0 });
  return { upcoming: shown, upcomingCount: upcoming.length, ...upcomingTotals, owed };
}

// Registrations made in each of the last 12 months (all events).
async function registrationsByMonth(months) {
  const rows = await readAll(() => supabaseAdmin
    .from('event_registrations').select('id, created_at')
    .gte('created_at', manilaMidnight(`${months[0]}-01`)).is('deleted_at', null).neq('status', 'cancelled').order('id'));
  const by = new Map(months.map((m) => [m, 0]));
  rows.forEach((r) => { const m = r.created_at && monthOf(r.created_at); if (by.has(m)) by.set(m, by.get(m) + 1); });
  return months.map((m) => ({ month: m, count: by.get(m) }));
}

// ---- Confirmed gifts by month and fund ----
async function givingPart(months) {
  const rows = await readAll(() => supabaseAdmin
    .from('giving_gifts').select('id, amount, fund, given_at')
    .eq('status', 'successful').gte('given_at', manilaMidnight(`${months[0]}-01`)).order('id'));
  const by = new Map(months.map((m) => [m, { tithes: 0, donations: 0 }]));
  rows.forEach((g) => {
    const b = g.given_at && by.get(monthOf(g.given_at));
    if (!b) return;
    const amount = Number(g.amount) || 0;
    if (g.fund === 'Donation') b.donations += amount; else b.tithes += amount;
  });
  const round = (n) => Math.round(n * 100) / 100;
  return months.map((m) => ({ month: m, tithes: round(by.get(m).tithes), donations: round(by.get(m).donations) }));
}

// ---- What is waiting on the office ----
async function attentionPart() {
  const [accounts, gifts, isom] = await Promise.all([
    part('accounts to verify', () => headCount(() => supabaseAdmin
      .from('users').select('id', { count: 'exact', head: true }).neq('is_active', false).neq('status', 'Verified'))),
    part('gifts to confirm', () => headCount(() => supabaseAdmin
      .from('giving_gifts').select('id', { count: 'exact', head: true }).eq('status', 'pending'))),
    part('isom', () => headCount(() => supabaseAdmin
      .from('isom_inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new'))),
  ]);
  return { accounts, gifts, isom };
}

// ---- The activity log (Super Admin) ----
const ACTIONS = {
  event_registration_update: 'updated a registration',
  event_registration_edit: 'edited a registration',
  event_register: 'registered someone for an event',
  event_registration_addons: "changed a registration's add-ons",
  event_registration_exempt: 'excused a registration from paying',
  event_payment_review_resolved: 'reviewed an event payment',
  event_payment_batch: 'checked event payments in a batch',
  update_event: 'updated an event',
  giving_gift_confirm: 'confirmed a gift',
  giving_gift_email: 'emailed a gift receipt',
  giving_campaign_create: 'started a donation drive',
  giving_campaign_update: 'updated a donation drive',
  export_gifts: 'exported the gifts list',
  service_video_create: 'added a service video',
  service_video_update: 'updated a service video',
  service_video_delete: 'removed a service video',
  live_stream_create: 'started a live stream',
  live_stream_end: 'ended a live stream',
  rfid_super_access_set: 'changed RFID master access',
};
const RESOURCES = {
  news_article: 'a news article', joy_knowledge: "Joy's knowledge", system_setting: 'a system setting',
  event: 'an event', announcement: 'an announcement', user: 'an account', sermon: 'a sermon',
};
const VERBS = { create: 'added', update: 'updated', delete: 'removed', edit: 'edited' };
function describeAction(action, resource) {
  if (ACTIONS[action]) return ACTIONS[action];
  const what = RESOURCES[resource] || (resource ? `a ${String(resource).replace(/_/g, ' ')}` : 'something');
  if (VERBS[action]) return `${VERBS[action]} ${what}`;
  return `${String(action || 'changed').replace(/_/g, ' ')} · ${what}`;
}

async function systemPart(today) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const [total, recent, latest] = await Promise.all([
    headCount(() => supabaseAdmin.from('audit_logs').select('id', { count: 'exact', head: true })),
    readAll(() => supabaseAdmin.from('audit_logs').select('id, created_at')
      .gte('created_at', manilaMidnight(days[0])).order('id')),
    supabaseAdmin.from('audit_logs').select('id, user_name, action, resource, created_at')
      .order('created_at', { ascending: false }).limit(5),
  ]);
  if (latest.error) throw latest.error;
  const by = new Map(days.map((d) => [d, 0]));
  recent.forEach((r) => { const d = churchDate(new Date(r.created_at)); if (by.has(d)) by.set(d, by.get(d) + 1); });
  return {
    total,
    days: days.map((d) => ({ date: d, count: by.get(d) })),
    latest: (latest.data || []).map((r) => ({
      id: r.id, who: r.user_name || 'Someone', what: describeAction(r.action, r.resource), at: r.created_at,
    })),
  };
}

export async function GET(request) {
  const actorId = new URL(request.url).searchParams.get('actorId');
  const who = await requireRole(actorId, ['Admin']);
  if (who.error) return NextResponse.json({ success: false, message: who.error }, { status: who.status });
  const isSuper = getUserRoles(who.user).includes('Super Admin');

  const today = churchDate();
  const dow = weekday(today);
  // The last Sunday people could check in at (today, on a Sunday).
  const lastSunday = dow === 0 ? today : addDays(today, -dow);
  const months = lastMonths(today, MONTHS);

  const [attention, members, attendance, ministries, events, registrations, giving, system] = await Promise.all([
    attentionPart(),
    part('members', () => membersPart(today, months)),
    part('attendance', () => attendancePart(lastSunday)),
    part('ministries', ministriesPart),
    part('events', () => eventsPart(today)),
    part('registrations', () => registrationsByMonth(months)),
    part('giving', () => givingPart(months)),
    isSuper ? part('system', () => systemPart(today)) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    success: true,
    today,
    isSuper,
    firstname: who.user.firstname || '',
    attention: {
      accounts: attention.accounts,
      gifts: attention.gifts,
      isom: attention.isom,
      payments: events ? events.owed : null,
    },
    members, attendance, ministries, events, registrations, giving, system,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
