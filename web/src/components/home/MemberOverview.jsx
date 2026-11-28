'use client';

// A Church Member's Home: the Admin Home's layout, filled with a member's
// week. What needs them (events to pay for, unread chat, gifts being
// confirmed, new announcements), their four numbers (next service, their
// events, their giving, the sermons), then this week at church, the latest
// sermon, their giving by month and the announcements.
// It reads the pages a member already has (events, registrations, giving,
// announcements, sermons); nothing new on the server.

import { useMemo } from 'react';
import { useMyGifts } from '@/lib/givingClient';
import { peso, phYear } from '@/lib/giving';
import { evtDate, evtStatus } from '@/lib/eventWhen';
import { SERVICE_TIMES, nextGathering } from '@/lib/serviceTimes';
import { REG_LABEL, REG_TONE, evtDay, useMyRegistrations, useUpcomingEvents, useAnnouncements, useSermons } from './churchData';
import {
  Head, Shortcuts, Attention, Kpis, Card, Grid, Chip, Empty, Cols, List, Verse,
  useIntro, plural, day, monthShort, whenWord, churchToday, daysBetween, TZ,
} from './homeParts';

const PAGES = {
  schedule: { section: 'weekly-schedule', label: 'Weekly Schedule', icon: 'fa-calendar-week' },
  events: { section: 'events', label: 'Events', icon: 'fa-calendar-alt' },
  sermons: { section: 'sermons', label: 'Sermons', icon: 'fa-book-bible' },
  community: { section: 'community-hub', label: 'Community Hub', icon: 'fa-comments' },
  messages: { section: 'messages', label: 'Chat', icon: 'fa-envelope' },
  announcements: { section: 'announcements', label: 'Announcements', icon: 'fa-bullhorn' },
  bible: { section: 'bible-reader', label: 'Bible Reader', icon: 'fa-bible' },
};
const SERVICE_ICONS = { 'fa-sun': 'fa-sun', 'fa-book-bible': 'fa-book-bible', 'fa-users': 'fa-users' };

const ymdIn = (value) => new Date(value).toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (ymd, n) => { const t = new Date(`${ymd}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const pesoK = (n) => {
  if (n >= 1e6) return `₱${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1000) return `₱${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K`;
  return `₱${Math.round(n)}`;
};
const isPending = (status) => REG_TONE[status] === 'warn';

// The regular services in the next 7 days, in church time; today's once it has started are left out.
function servicesThisWeek(today) {
  const nowHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const ymd = addDays(today, i);
    const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    SERVICE_TIMES.filter((s) => s.dow === dow && !(i === 0 && nowHour >= s.hour)).forEach((s) => out.push({ ymd, s }));
  }
  return out;
}

/**
 * @param {object}   viewer       the signed-in account (the dashboard's userData)
 * @param {Function} canOpen      may this account open a section?
 * @param {Function} go           open a section: go('events')
 * @param {Function} openGive     open a Give page: openGive('tithes' | 'donations' | 'my')
 * @param {number}   unreadChat   unread chat messages (the sidebar's badge)
 * @param {object}   verse        the verse of the day: { verse, reference }
 */
export default function MemberOverview({ viewer, canOpen, go, openGive, unreadChat = 0, verse }) {
  const today = churchToday();
  const { gifts, loading: giftsLoading } = useMyGifts(viewer);
  const regs = useMyRegistrations(viewer?.id);
  const events = useUpcomingEvents();
  const notices = useAnnouncements();
  const sermons = useSermons(viewer?.id);
  const ready = !giftsLoading && !regs.loading && !events.loading;
  const intro = useIntro(ready);

  const page = (key) => {
    const p = PAGES[key];
    return p && canOpen?.(p.section) ? () => go(p.section) : null;
  };
  const year = phYear();

  // ---- Their events, giving, sermons ----
  const mine = Object.values(regs.byEvent)
    .filter((r) => evtStatus(r.event.event_date, r.event.end_date) !== 'ended')
    .sort((a, b) => (evtDate(a.event.event_date)?.getTime() || 0) - (evtDate(b.event.event_date)?.getTime() || 0));
  const toPay = mine.filter((r) => isPending(r.status));
  const giving = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const [y, m] = today.slice(0, 7).split('-').map(Number);
      return new Date(Date.UTC(y, m - 1 - (5 - i), 1)).toISOString().slice(0, 7);
    });
    const byMonth = Object.fromEntries(months.map((m) => [m, 0]));
    let given = 0;
    let count = 0;
    let pending = 0;
    (gifts || []).forEach((g) => {
      if (g.status === 'pending') pending += 1;
      if (g.status !== 'successful' || !g.given_at) return;
      const amount = Number(g.amount) || 0;
      if (phYear(g.given_at) === String(year)) { given += amount; count += 1; }
      const m = ymdIn(g.given_at).slice(0, 7);
      if (m in byMonth) byMonth[m] += amount;
    });
    return { given, count, pending, months: months.map((m) => ({ month: m, value: Math.round(byMonth[m]) })) };
  }, [gifts, today, year]);
  const sermonsThisYear = sermons.list.filter((s) => String(s.preachedOn || '').startsWith(String(year)));
  const latest = sermons.list[0];
  const newNotices = notices.list.filter((a) => a.created_at && daysBetween(ymdIn(a.created_at), today) <= 7);
  const next = nextGathering(Date.now());

  // ---- Shortcuts ----
  const shortcuts = [
    ['schedule', 'This week'],
    ['events', mine.length ? `${mine.length} signed up` : 'Coming up'],
    ['sermons', latest ? `Latest: ${day(latest.preachedOn, { month: 'short', day: 'numeric' })}` : 'Listen again'],
    ['community', 'Posts and prayer'],
    ['give', 'Tithes and gifts'],
    ['bible', 'Read today'],
  ].map(([key, hint]) => (key === 'give'
    ? { key, hint, label: 'Give', icon: 'fa-hand-holding-heart', onClick: () => openGive('tithes') }
    : { key, hint, ...PAGES[key], onClick: page(key) }))
    .filter((s) => s.onClick);

  // ---- Needs your attention ----
  const attention = [];
  if (toPay.length) attention.push({ key: 'pay', n: toPay.length, text: toPay.length === 1 ? 'Event payment to finish' : 'Event payments to finish', small: `${toPay[0].event.title} · ${REG_LABEL[toPay[0].status] || ''}`, icon: 'fa-receipt', tone: 'serious', onClick: page('events') });
  if (mine.length) attention.push({ key: 'events', n: mine.length, text: mine.length === 1 ? 'Event you signed up for' : 'Events you signed up for', small: `${mine[0].event.title}, ${evtDay(mine[0].event.event_date)}`, icon: 'fa-calendar-check', tone: 'good', onClick: page('events') });
  if (unreadChat > 0) attention.push({ key: 'chat', n: unreadChat, text: 'Unread in Chat', small: 'Messages waiting for you', icon: 'fa-envelope', tone: 'warn', onClick: page('messages') });
  if (giving.pending > 0) attention.push({ key: 'gifts', n: giving.pending, text: giving.pending === 1 ? 'Gift being confirmed' : 'Gifts being confirmed', small: 'The church office checks each one', icon: 'fa-hand-holding-heart', tone: 'serious', onClick: () => openGive('my') });
  if (newNotices.length) attention.push({ key: 'news', n: newNotices.length, text: newNotices.length === 1 ? 'New announcement' : 'New announcements', small: newNotices[0].title, icon: 'fa-bullhorn', tone: '', onClick: page('announcements') });
  const tiles = attention.slice(0, 4);
  [
    { key: 'clear-events', n: 0, text: 'Event payments to finish', small: 'All clear' },
    { key: 'clear-chat', n: 0, text: 'Unread in Chat', small: 'All caught up' },
    { key: 'clear-gifts', n: 0, text: 'Gifts being confirmed', small: 'Every gift confirmed' },
  ].forEach((f) => { if (tiles.length < 3 && !tiles.some((t) => t.text === f.text)) tiles.push(f); });

  // ---- Key figures ----
  const nextYmd = next ? ymdIn(next.startMs) : null;
  const kpis = [
    next
      ? { key: 'next', label: 'Next service', value: whenWord(today, nextYmd), detail: `${next.name} · ${next.day} ${next.time}`, onClick: page('schedule') }
      : { key: 'next', label: 'Next service', value: 'Sunday', detail: 'Worship Service · 9:00 AM', onClick: page('schedule') },
    { key: 'events', label: 'My events', value: String(mine.length), detail: mine.length ? `coming up · next ${evtDay(mine[0].event.event_date)}` : 'None yet · register for one', onClick: page('events') },
    { key: 'given', label: `Given in ${year}`, value: giftsLoading ? '…' : peso(giving.given), detail: giving.count ? `${plural(giving.count, 'gift')}${giving.pending ? ` · ${giving.pending} being confirmed` : ''}` : 'Tithes, offerings and donations', spark: giving.months.map((m) => m.value), onClick: () => openGive('my') },
    { key: 'sermons', label: 'Sermons', value: sermons.loading ? '…' : String(sermonsThisYear.length), detail: latest ? `posted in ${year} · latest ${day(latest.preachedOn, { month: 'short', day: 'numeric' })}` : `posted in ${year}`, onClick: page('sermons') },
  ];

  // ---- Cards ----
  const week = [
    ...servicesThisWeek(today).map(({ ymd, s }) => ({ when: `${ymd}T${String(s.hour).padStart(2, '0')}`, key: `s-${ymd}-${s.dow}`, icon: SERVICE_ICONS[s.icon] || 'fa-church', title: s.name, sub: `${day(ymd, { weekday: 'long', month: 'short', day: 'numeric' })} · ${s.time}`, end: daysBetween(today, ymd) <= 1 ? <Chip>{whenWord(today, ymd)}</Chip> : null })),
    ...mine.filter((r) => { const d = evtDate(r.event.event_date); return d && daysBetween(today, ymdIn(d)) <= 30; })
      .map((r) => ({ when: ymdIn(evtDate(r.event.event_date)), key: `e-${r.event.id}`, icon: 'fa-calendar-check', title: r.event.title, sub: evtDay(r.event.event_date), end: <Chip tone={isPending(r.status) ? 'warn' : 'good'}>{REG_LABEL[r.status] || 'Registered'}</Chip> })),
  ].sort((a, b) => a.when.localeCompare(b.when)).slice(0, 6);
  const otherEvents = events.list.filter((e) => !regs.byEvent[e.id]).slice(0, Math.max(0, 5 - week.length));

  const rows = [
    [
      { span: 7, node: (span) => (
        <Card key="week" span={span} id="rh-week" title="This week at church" sub="The services, and the events you signed up for" more={page('events') && { label: 'All events', onClick: page('events') }}>
          <List items={[
            ...week,
            ...otherEvents.map((e) => ({ key: `o-${e.id}`, icon: 'fa-calendar-alt', title: e.title, sub: `${evtDay(e.event_date)}${e.loc_city ? ` · ${e.loc_city}` : ''}`, end: page('events') ? <button type="button" className="rh-mini" onClick={page('events')}>View</button> : null })),
          ]} />
        </Card>
      ) },
      { span: 5, node: (span) => (
        <Card key="sermon" span={span} id="rh-sermon" title="Latest sermon" sub={latest ? `Preached ${day(latest.preachedOn, { weekday: 'long', month: 'short', day: 'numeric' })}` : 'From the pulpit'}>
          {latest ? (
            <div className="rh-feature">
              <h4>{latest.title}</h4>
              <p>{[latest.preacher, latest.passage].filter(Boolean).join(' · ')}</p>
              {latest.summary && <p>{latest.summary.length > 220 ? `${latest.summary.slice(0, 217)}…` : latest.summary}</p>}
              <div className="rh-btns">
                {latest.url && <a className="rh-mini" href={latest.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>Open</a>}
                {page('sermons') && <button type="button" className="rh-mini" onClick={page('sermons')}>All sermons</button>}
              </div>
            </div>
          ) : <Empty icon="fa-book-bible" title={sermons.loading ? 'Loading…' : 'No sermons yet'}>{sermons.loading ? '' : 'Sermons show here once the pastors upload them.'}</Empty>}
        </Card>
      ) },
    ],
    [
      { span: 7, node: (span) => (
        <Card key="giving" span={span} id="rh-giving" title="My giving by month" sub="Confirmed gifts, the last 6 months" more={{ label: 'My giving', onClick: () => openGive('my') }}>
          {giving.months.some((m) => m.value) ? (
            <Cols cols={giving.months.map((m) => ({ key: m.month, label: monthShort(m.month), value: m.value }))} fmt={pesoK} />
          ) : <Empty icon="fa-hand-holding-heart" title="No gifts in the last 6 months">Your tithes, offerings and donations show here, with receipts in My giving.</Empty>}
        </Card>
      ) },
      { span: 5, node: (span) => (
        <Card key="notes" span={span} id="rh-notes" title="Announcements" sub="Pinned first" more={page('announcements') && { label: 'All', onClick: page('announcements') }}>
          {notices.list.length ? (
            <List items={notices.list.slice(0, 3).map((a) => ({
              key: a.id,
              icon: a.is_pinned ? 'fa-thumbtack' : 'fa-bullhorn',
              title: a.title,
              sub: a.content ? (a.content.length > 110 ? `${a.content.slice(0, 107)}…` : a.content) : '',
              end: a.is_pinned ? <Chip tone="gold">Pinned</Chip> : null,
            }))} />
          ) : <Empty icon="fa-bullhorn" title={notices.loading ? 'Loading…' : 'No announcements right now'}>{notices.loading ? '' : 'News from the church shows here.'}</Empty>}
        </Card>
      ) },
    ],
  ];

  return (
    <div className={`ao rh${intro ? ' ao-intro' : ''}`}>
      <Head name={String(viewer?.firstname || '').trim().split(/\s+/)[0]} pills={[{ label: 'Church Member', icon: 'fa-church' }]} />
      <Shortcuts items={shortcuts} />
      <Attention items={tiles} />
      <Kpis items={kpis} />
      <Grid rows={rows} />
      <Verse verse={verse} />
    </div>
  );
}
