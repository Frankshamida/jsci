'use client';

// A Ministry Member's Home: the Admin Home's layout, filled with what their
// own ministry roles need. What needs them first, their four numbers, then
// their next lineup and Sundays, and the cards of the roles they lead:
//   Singers, musicians, dancers   next lineup with its songs, their next
//                                 Sundays, subs and swaps
//   Song Leader                   songs still to add, the songs they lead most
//   Music Director / Head Dancer  the band / the dancers on the next Sundays,
//                                 and how often each one serves
//   Schedule Plotter              approvals waiting, Sundays plotted
//   Media team                    songs needing lyrics, recordings
//   Ushers                        services and the events they usher; a Head
//                                 Usher, every usher's check-ins
// One request to /api/home/ministry (plus the meetings list), refreshed while
// Home is open (useSmartPoll stops it in a hidden or idle tab).

import { useCallback, useState } from 'react';
import { useSmartPoll, POLL_MS } from '@/lib/pollingConfig';
import { evtDate } from '@/lib/eventWhen';
import {
  Head, Loading, Shortcuts, Attention, Kpis, Card, Grid, Chip, Empty, Rows, Cols, List, Verse,
  useIntro, plural, day, monthShort, monthLong, whenWord, inDays, clock,
} from './homeParts';

// Each page a shortcut or a card can open. `tab` picks a tab inside it.
const PAGES = {
  schedule: { section: 'weekly-schedule', label: 'Weekly Schedule', icon: 'fa-calendar-week' },
  pw: { section: 'praise-worship', label: 'Praise & Worship', icon: 'fa-hands-praying' },
  subs: { section: 'praise-worship', tab: { pawTab: 'schedules' }, label: 'Praise & Worship', icon: 'fa-hands-praying' },
  lyrics: { section: 'praise-worship', tab: { pawTab: 'lyrics-library' }, label: 'Lyrics', icon: 'fa-align-left' },
  addSongs: { section: 'create-lineup', tab: { lineupTab: 'assign' }, label: 'Add songs', icon: 'fa-music' },
  plan: { section: 'create-lineup', tab: { lineupTab: 'planner' }, label: 'Plot the month', icon: 'fa-table-cells' },
  approvals: { section: 'create-lineup', tab: { lineupTab: 'paw-logs' }, label: 'Approvals', icon: 'fa-clipboard-check' },
  playlist: { section: 'song-playlist', label: 'Song Playlist', icon: 'fa-compact-disc' },
  meetings: { section: 'ministry-meetings', label: 'Ministry Meetings', icon: 'fa-handshake' },
  recordings: { section: 'recordings', label: 'Recordings', icon: 'fa-microphone-alt' },
  events: { section: 'events', label: 'Events', icon: 'fa-calendar-alt' },
  cevents: { section: 'community-events', label: 'Community Events', icon: 'fa-calendar-day' },
  messages: { section: 'messages', label: 'Chat', icon: 'fa-envelope' },
  bible: { section: 'bible-reader', label: 'Bible Reader', icon: 'fa-bible' },
};

const POSITION_ICONS = {
  'Song Leader': 'fa-microphone', 'Backup Singer': 'fa-microphone-lines', 'Music Director': 'fa-sliders',
  Keyboard: 'fa-keyboard', Guitarist: 'fa-guitar', Bass: 'fa-guitar', Drummer: 'fa-drum',
  'Head Dancer': 'fa-person-running', Dancer: 'fa-person-running',
  'Media Head': 'fa-camera', Lyrics: 'fa-align-left', 'Media Live': 'fa-video', Graphics: 'fa-palette', Technical: 'fa-sliders', 'Social Media': 'fa-share-nodes',
  'Head Usher': 'fa-door-open', Usher: 'fa-door-open', 'Schedule Plotter': 'fa-calendar-check',
};
const INSTRUMENTS = ['Keyboard', 'Guitar', 'Bass', 'Drums'];

const short = (ymd) => day(ymd, { weekday: 'short', month: 'short', day: 'numeric' });
const eventDay = (value) => evtDate(value)?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) || '';
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const firstOf = (name) => String(name || '').split(' ')[0];
const isOut = (p) => p.excuse === 'Approved' || !!p.subRequest;

// A person on a lineup: "You", or their name, marked when they are out.
function Who({ p, me, extra }) {
  const mine = p.name.toLowerCase() === me.toLowerCase();
  const label = mine ? <span className="rh-me">You</span> : p.name;
  return (
    <span style={{ display: 'block' }}>
      {isOut(p) ? <s title={p.excuse === 'Approved' ? 'Excused' : 'Asked for a sub'}>{label}</s> : label}
      {extra ? `, ${extra}` : ''}
      {p.covering ? ` (for ${p.covering})` : ''}
    </span>
  );
}

// What one of their dates holds, as a chip.
function dayChip(d) {
  if (d.covering) return ['gold', 'Covering'];
  if (d.state === 'serving') {
    if (d.sub && d.sub.status !== 'Accepted') return ['warn', 'Sub asked'];
    if (d.swap) return ['warn', 'Swap pending'];
    if (d.parts.includes('Song Leader')) return ['gold', 'Leading'];
    const instrument = d.parts.find((p) => INSTRUMENTS.includes(p));
    return ['gold', instrument || 'Serving'];
  }
  if (d.state === 'excused') return ['warn', 'Excused'];
  if (d.state === 'covered') return ['soft', 'Covered'];
  if (d.state === 'rest') return ['soft', 'Rest'];
  return ['dash', 'Not plotted'];
}

export function MinistryOverviewView({ data, meetings, error, onRetry, firstname, canOpen, go, openTab, verse }) {
  const intro = useIntro(!!data);
  if (!data) return <Loading name={firstname} error={error} onRetry={onRetry} />;

  const { today, me, days, lineups, requests, checkins, history, plotter, media, ushers } = data;
  const name = me.firstname || firstname || '';
  const page = (key) => {
    const p = PAGES[key];
    if (!p || !canOpen?.(p.section)) return null;
    return () => (p.tab ? openTab(p.section, p.tab) : go(p.section));
  };
  const lineupOn = (date) => lineups.find((l) => l.date === date);
  const nextMeeting = (meetings || []).find((m) => m.status !== 'Cancelled' && Date.parse(m.startsAt) >= Date.now() - 2 * 3600000);

  // ---- Their next date, next lineup and next time leading ----
  const nextDay = days.find((d) => d.state === 'serving' || d.covering);
  const myLineup = lineups.find((l) => l.mine);
  const leadDay = days.find((d) => d.state === 'serving' && d.parts.includes('Song Leader'));
  const leadLineup = leadDay ? lineupOn(leadDay.date) : null;
  const unplotted = days.filter((d) => d.state === 'unplotted').length;
  const sundaysAhead = days.filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 0);
  const present = checkins.sundays.filter((s) => s.status === 'Present' || s.status === 'Late');
  const onTime = checkins.sundays.filter((s) => s.status === 'Present').length;
  const onDay = (ymd) => (/^To/.test(whenWord(today, ymd)) ? whenWord(today, ymd).toLowerCase() : `on ${short(ymd)}`);
  const partWord = (d) => (d.parts.includes('Song Leader') ? 'you lead' : d.parts[0] || (d.covering ? `covering for ${d.covering}` : 'serving'));

  // ---- Shortcuts: their own first, then the everyday pages ----
  const shortcutKeys = [
    me.plotter && ['plan', plotter?.months?.[1] ? `${monthShort(plotter.months[1].month)}: ${plotter.months[1].plotted} of ${plotter.months[1].sundays} plotted` : 'Monthly Planner'],
    me.songLeader && ['addSongs', leadDay ? `For ${short(leadDay.date)}` : 'Your next lineup'],
    me.media && ['lyrics', media ? (media.needing.length ? `${plural(media.needing.length, 'song')} need lyrics` : 'All lyrics ready') : 'Library'],
    me.usher && ['events', ushers?.mine?.length ? `${ushers.mine.length} to usher` : 'Coming up'],
    ['schedule', nextDay ? `Next: ${short(nextDay.date)}` : 'My Sundays'],
    data.onLineups && ['playlist', myLineup?.songs?.length ? 'Learn the songs' : 'Find a song'],
    (data.onLineups || me.media) && ['pw', 'Team and lyrics'],
    ['meetings', nextMeeting ? whenWord(today, new Date(nextMeeting.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })) : 'Ministry meetings'],
    ['messages', 'Ministry group chats'],
    me.media && ['recordings', 'Services'],
    me.usher && ['cevents', 'This month'],
    ['bible', 'Read today'],
  ].filter(Boolean);
  const seen = new Set();
  const shortcuts = shortcutKeys
    .map(([key, hint]) => ({ key, hint, onClick: page(key), ...PAGES[key] }))
    .filter((s) => s.onClick && !seen.has(s.section + (s.tab ? JSON.stringify(s.tab) : '')) && seen.add(s.section + (s.tab ? JSON.stringify(s.tab) : '')))
    .slice(0, 6);

  // ---- Needs your attention ----
  const attention = [];
  if (plotter) {
    const n = plotter.approvals.length;
    attention.push({ key: 'approvals', n, text: n === 1 ? 'Approval waiting' : 'Approvals waiting', small: n ? [...new Set(plotter.approvals.map((a) => (a.kind === 'sub' ? 'subs' : a.kind === 'swap' ? 'swaps' : 'excuses')))].join(', ') : 'All clear', icon: 'fa-clipboard-check', tone: 'serious', onClick: page('approvals') });
    if (unplotted) attention.push({ key: 'plot', n: unplotted, text: unplotted === 1 ? 'Date not plotted yet' : 'Dates not plotted yet', small: `In the next ${plural(days.length, 'week')}`, icon: 'fa-table-cells', tone: 'warn', onClick: page('plan') });
  }
  if (me.songLeader && leadLineup) {
    const fast = (leadLineup.fastSongs || []).filter((s) => s.title).length;
    const slow = (leadLineup.slowSongs || []).filter((s) => s.title).length;
    if (!fast || !slow) {
      attention.push({ key: 'songs', n: fast + slow, text: fast + slow ? `No ${!fast ? 'fast' : 'slow'} songs yet` : 'Songs to add', small: `You lead ${short(leadDay.date)}`, icon: 'fa-music', tone: 'serious', onClick: page('addSongs') });
    }
  }
  if (media?.needing?.length) attention.push({ key: 'lyrics', n: media.needing.length, text: media.needing.length === 1 ? 'Song needing lyrics' : 'Songs needing lyrics', small: [...new Set(media.needing.map((s) => short(s.date)))].slice(0, 2).join(' and '), icon: 'fa-align-left', tone: 'serious', onClick: page('lyrics') });
  if (requests.swapsForMe.length) {
    const w = requests.swapsForMe[0];
    attention.push({ key: 'swaps', n: requests.swapsForMe.length, text: 'Swap asked of you', small: `${w.from} · answer in the Ministry app`, icon: 'fa-right-left', tone: 'warn' });
  }
  if (requests.openSubs.length) {
    const s = requests.openSubs[0];
    attention.push({ key: 'subs', n: requests.openSubs.length, text: requests.openSubs.length === 1 ? 'Sub you can take' : 'Subs you can take', small: `${s.roleType} · ${short(s.date)}`, icon: 'fa-hand-holding-hand', tone: 'good', onClick: page('subs') });
  }
  const mySubOpen = requests.subs.find((s) => s.status !== 'Accepted');
  if (mySubOpen) attention.push({ key: 'mysub', n: 1, text: 'Your sub request', small: `${short(mySubOpen.date)} · ${mySubOpen.status === 'Pending Admin' ? 'waiting for the plotter' : 'nobody has taken it yet'}`, icon: 'fa-user-clock', tone: 'warn', onClick: page('subs') });
  if (myLineup && data.onLineups) {
    const fresh = myLineup.songs.filter((s) => s.newToMe).length;
    if (fresh) attention.push({ key: 'new', n: fresh, text: fresh === 1 ? 'Song new to you' : 'Songs new to you', small: `In your lineup ${onDay(myLineup.date)}`, icon: 'fa-star', tone: 'good', onClick: page('playlist') });
    else if (myLineup.songs.length) attention.push({ key: 'learn', n: myLineup.songs.length, text: 'Songs in your next lineup', small: `Your lineup ${onDay(myLineup.date)}`, icon: 'fa-music', tone: 'good', onClick: page('playlist') });
  }
  if (ushers?.mine?.length) attention.push({ key: 'usher', n: ushers.mine.length, text: ushers.mine.length === 1 ? 'Event you usher' : "Events you're ushering", small: ushers.mine.slice(0, 2).map((e) => eventDay(e.date)).join(' and '), icon: 'fa-door-open', tone: 'good', onClick: page('events') });
  if (ushers?.events) {
    const none = ushers.events.filter((e) => !e.ushers).length;
    if (none) attention.push({ key: 'noushers', n: none, text: none === 1 ? 'Event with no ushers yet' : 'Events with no ushers yet', small: ushers.events.find((e) => !e.ushers).title, icon: 'fa-triangle-exclamation', tone: 'warn', onClick: page('events') });
  }
  if (me.mediaHead && media?.lastSundayRecorded === false) attention.push({ key: 'rec', n: 1, text: "Last Sunday's recording", small: 'Not uploaded yet', icon: 'fa-video', tone: 'warn', onClick: page('recordings') });
  if (nextMeeting) {
    const ymd = new Date(nextMeeting.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const away = Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (away <= 7) attention.push({ key: 'meet', n: 1, text: nextMeeting.title || 'Ministry meeting', small: `${whenWord(today, ymd)} · ${new Date(nextMeeting.startsAt).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })}`, icon: 'fa-handshake', tone: '', onClick: page('meetings') });
  }
  const fillers = [
    { key: 'clear-req', n: 0, text: 'Requests waiting on you', small: 'All clear' },
    { key: 'clear-subs', n: 0, text: 'Subs you can take', small: 'None right now' },
    { key: 'clear-swaps', n: 0, text: 'Swaps asked of you', small: 'None right now' },
  ];
  const tiles = attention.slice(0, 4);
  fillers.forEach((f) => { if (tiles.length < 3) tiles.push(f); });

  // ---- Key figures ----
  const firstSunday = sundaysAhead[0]?.date || days[0]?.date || today;
  const kpis = [];
  if (data.onLineups) {
    kpis.push(nextDay
      ? { key: 'next', label: 'Next serving', value: whenWord(today, nextDay.date), detail: `${/^To/.test(whenWord(today, nextDay.date)) ? day(nextDay.date, { weekday: 'long', month: 'short', day: 'numeric' }) : inDays(today, nextDay.date).replace(/^./, (c) => c.toUpperCase())} · ${partWord(nextDay)}`, onClick: page('schedule') }
      : { key: 'next', label: 'Next serving', value: 'Not yet', detail: unplotted ? 'The next Sundays are not plotted yet' : 'Resting the next Sundays', onClick: page('schedule') });
  } else {
    kpis.push({ key: 'next', label: 'Next service', value: whenWord(today, firstSunday), detail: 'Worship Service · Sunday 9:00 AM', onClick: page('schedule') });
  }
  if (me.songLeader) {
    if (leadLineup) {
      const fast = (leadLineup.fastSongs || []).filter((s) => s.title).length;
      const slow = (leadLineup.slowSongs || []).filter((s) => s.title).length;
      kpis.push({ key: 'songs', label: 'Songs added', value: String(fast + slow), detail: `for ${short(leadDay.date)} · ${fast} fast, ${slow} slow`, onClick: page('addSongs') });
    } else {
      kpis.push({ key: 'songs', label: 'Leading next', value: 'Not yet', detail: unplotted ? 'Not plotted that far yet' : 'Not on the next Sundays', onClick: page('schedule') });
    }
  } else if (data.onLineups) {
    const serving = days.filter((d) => d.state === 'serving' || d.covering).length;
    kpis.push({ key: 'serving', label: 'Serving soon', value: `${serving} of ${days.length}`, detail: `the next dates${unplotted ? ` · ${unplotted} not plotted` : ''}`, spark: history.servedByMonth.map((m) => m.count), onClick: page('schedule') });
  } else if (media) {
    const added = media.addedByMonth[media.addedByMonth.length - 1]?.count || 0;
    kpis.push({ key: 'library', label: 'Lyrics library', value: media.libraryCount.toLocaleString('en-US'), detail: `songs · ${added} added in ${monthShort(today.slice(0, 7))}`, spark: media.addedByMonth.map((m) => m.count), onClick: page('lyrics') });
  } else if (ushers) {
    kpis.push({ key: 'events', label: 'Events to usher', value: String(ushers.mine.length), detail: ushers.mine[0] ? `${ushers.mine[0].title}, ${eventDay(ushers.mine[0].date)}` : 'None assigned yet', onClick: page('events') });
  }
  if (data.onLineups) {
    const pl = myLineup || null;
    kpis.push(pl?.practiceDate
      ? { key: 'practice', label: 'Practice', value: whenWord(today, pl.practiceDate), detail: [clock(pl.practiceTime), `for ${short(pl.date)}`].filter(Boolean).join(' · '), onClick: page('meetings') }
      : { key: 'practice', label: 'Practice', value: 'Not set', detail: pl ? `No practice date on ${short(pl.date)} yet` : 'Shows with your next lineup' });
  } else if (media) {
    kpis.push({ key: 'needing', label: 'Songs needing lyrics', value: String(media.needing.length), detail: 'in the coming lineups', onClick: page('lyrics') });
  } else if (ushers) {
    kpis.push(nextMeeting
      ? { key: 'meeting', label: 'Next meeting', value: whenWord(today, new Date(nextMeeting.startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })), detail: nextMeeting.title, onClick: page('meetings') }
      : { key: 'meeting', label: 'Next meeting', value: 'None', detail: 'Nothing scheduled yet', onClick: page('meetings') });
  }
  kpis.push({ key: 'checkins', label: 'Sunday check-ins', value: `${present.length} of ${checkins.sundays.length}`, detail: `${onTime} on time · last ${checkins.sundays.length} Sundays`, spark: checkins.byMonth.map((m) => m.count) });
  while (kpis.length > 4) kpis.splice(kpis.length - 2, 1);

  // ---- Cards ----
  const rows = [];

  // Schedule Plotter: the next dates at a glance, and what waits on them.
  if (plotter) {
    rows.push([
      { span: 8, node: (span) => (
        <Card key="glance" span={span} id="rh-glance" title="The next Sundays at a glance" sub="Who is plotted on each date" more={page('plan') && { label: 'Monthly Planner', onClick: page('plan') }}>
          <div className="ao-scroll">
            <table className="ao-table rh-table">
              <thead><tr><th>Date</th><th>Song leader</th><th>Backup</th><th>Band</th><th>Dancers</th><th className="r">Changes</th></tr></thead>
              <tbody>
                {days.map((d) => {
                  const l = lineupOn(d.date);
                  if (!l) return <tr key={d.date}><th>{short(d.date)}</th><td colSpan={5}><Chip tone="dash">Not plotted yet</Chip></td></tr>;
                  const people = [l.songLeader, ...l.backupSingers, ...l.musicians, ...l.dancers].filter(Boolean);
                  const changes = people.filter(isOut).length;
                  return (
                    <tr key={d.date}>
                      <th>{short(d.date)}</th>
                      <td>{l.songLeader ? l.songLeader.name.split(' ')[0] : <Chip tone="warn">None</Chip>}</td>
                      <td>{l.backupSingers.length}</td>
                      <td>{l.musicians.length}</td>
                      <td>{l.dancers.length}</td>
                      <td className="r">{changes ? <Chip tone="warn">{plural(changes, 'change')}</Chip> : <Chip tone="good">None</Chip>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) },
      { span: 4, node: (span) => (
        <Card key="approvals" span={span} id="rh-approvals" title="Approvals" sub="Waiting on you" more={page('approvals') && plotter.approvals.length > 0 && { label: 'Review', onClick: page('approvals') }}>
          {plotter.approvals.length ? (
            <List items={plotter.approvals.slice(0, 5).map((a) => ({
              key: `${a.kind}-${a.id}`,
              icon: a.kind === 'swap' ? 'fa-right-left' : a.kind === 'sub' ? 'fa-user-group' : 'fa-user-clock',
              title: a.title,
              sub: [a.sub, a.dates.map(short).join(' and ')].filter(Boolean).join(' · '),
            }))} />
          ) : <Empty icon="fa-circle-check" title="Nothing waiting">Excuses, subs and swaps to approve show here.</Empty>}
        </Card>
      ) },
    ]);
    rows.push([
      { span: 6, node: (span) => (
        <Card key="plotted" span={span} id="rh-plotted" title="Sundays plotted" sub="This month and the next two">
          <Rows rows={plotter.months.map((m) => ({ key: m.month, name: monthLong(m.month), value: `${m.plotted} of ${m.sundays}`, pct: pct(m.plotted, m.sundays) }))} />
        </Card>
      ) },
      history.singers.length > 0 && { span: 6, node: (span) => (
        <Card key="singers" span={span} id="rh-singers" title="Sundays per singer" sub="Last 3 months and the next 6 weeks · keep it even">
          <Rows rows={history.singers.map((s) => ({ key: s.name, name: s.name, me: s.name === me.name, value: s.count, pct: pct(s.count, history.singers[0].count) }))} />
        </Card>
      ) },
    ]);
  }

  // On the lineups: the next lineup, beside their Sundays and their requests.
  if (data.onLineups) {
    const requestItems = [
      ...requests.openSubs.map((s) => ({ key: `os-${s.id}`, icon: 'fa-hand-holding-hand', title: `${s.roleType} · ${short(s.date)}`, sub: `${s.from} asked for a sub`, end: page('subs') ? <button type="button" className="rh-mini" onClick={page('subs')}>Take it</button> : null })),
      ...requests.swapsForMe.map((w) => ({ key: `sw-${w.id}`, icon: 'fa-right-left', title: `${w.from} asks to swap`, sub: `Their ${short(w.theirDate)} for your ${short(w.myDate)} · answer in the Ministry app`, end: <Chip tone="warn">Waiting</Chip> })),
      ...requests.subs.map((s) => ({ key: `ms-${s.id}`, icon: 'fa-user-clock', title: `Your sub request · ${short(s.date)}`, sub: s.status === 'Accepted' ? `${s.by || 'Someone'} takes your place` : s.status === 'Pending Admin' ? 'Waiting for the Schedule Plotter' : 'Approved. Waiting for someone to take it', end: <Chip tone={s.status === 'Accepted' ? 'good' : 'warn'}>{s.status === 'Accepted' ? 'Covered' : s.status === 'Pending Admin' ? 'Waiting' : 'Sub open'}</Chip> })),
      ...requests.excuses.filter((e) => !requests.subs.some((s) => s.date === e.date)).map((e) => ({ key: `ex-${e.id}`, icon: 'fa-calendar-xmark', title: `Your excuse · ${short(e.date)}`, sub: e.status === 'Approved' ? 'Approved' : 'Waiting for the Schedule Plotter', end: <Chip tone={e.status === 'Approved' ? 'good' : 'warn'}>{e.status}</Chip> })),
    ];
    rows.push([
      { span: 7, node: (span) => (
        <Card key="lineup" span={span} tall={span < 12} id="rh-lineup" title={myLineup && leadDay && myLineup.date === leadDay.date ? 'Your next lineup' : 'Your next Sunday'} sub={myLineup ? `${myLineup.songLeader ? `${myLineup.songLeader.name === me.name ? 'You lead' : `${myLineup.songLeader.name} leads`} · ` : ''}${day(myLineup.date, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'Your lineup, its songs and who is on it'}>
          <NextLineup l={myLineup} me={me} today={today} unplotted={unplotted} page={page} />
        </Card>
      ) },
      { span: 5, node: (span) => (
        <Card key="sundays" span={span} id="rh-sundays" title="My next Sundays" sub="From the plotted schedule" more={page('schedule') && { label: 'Weekly Schedule', onClick: page('schedule') }}>
          <div className="rh-mo" style={{ '--rh-n': Math.min(days.length, 4) || 1 }}>
            {days.slice(0, 4).map((d) => {
              const [tone, label] = dayChip(d);
              return (
                <div key={d.date} className={d.state === 'serving' || d.covering ? 'is-serving' : d.state === 'unplotted' ? 'is-unplotted' : ''}>
                  <small>{day(d.date, { weekday: 'long' })}</small>
                  <b>{day(d.date, { month: 'short', day: 'numeric' })}</b>
                  <Chip tone={tone}>{label}</Chip>
                </div>
              );
            })}
          </div>
          {days.slice(0, 4).some((d) => d.state === 'unplotted') && <p className="rh-note">{days.slice(0, 4).every((d) => d.state === 'unplotted') ? 'Not plotted yet. Your Sundays show here once the Schedule Plotter plots them.' : 'Dates not plotted yet fill in once the Schedule Plotter plots them.'}</p>}
        </Card>
      ) },
      { span: 5, node: (span) => (
        <Card key="requests" span={span} id="rh-requests" title="Requests" sub="Subs you can take, swaps, and your own">
          {requestItems.length ? <List items={requestItems.slice(0, 5)} /> : <Empty icon="fa-circle-check" title="No requests">Subs you can take and swaps asked of you show here.</Empty>}
        </Card>
      ) },
    ]);
  }

  // Song Leader: the songs they lead most.
  if (me.songLeader && history.ledSongs.length) {
    rows.push([
      { span: 12, node: (span) => (
        <Card key="led" span={span} id="rh-led" title="Songs you lead most" sub="Last 6 months, from your lineups" more={page('playlist') && { label: 'Song Playlist', onClick: page('playlist') }}>
          <Rows rows={history.ledSongs.map((s) => ({ key: s.title, name: s.title, value: s.count, pct: pct(s.count, history.ledSongs[0].count) }))} />
        </Card>
      ) },
    ]);
  }

  // Music Director: the band on the next dates, and how often each plays.
  if (me.musicDirector) {
    rows.push([
      { span: 7, node: (span) => (
        <Card key="band" span={span} id="rh-band" title="The band, the next Sundays" sub="Who plays what on each date">
          <div className="ao-scroll">
            <table className="ao-table rh-table">
              <thead><tr><th>Date</th>{INSTRUMENTS.map((i) => <th key={i}>{i}</th>)}</tr></thead>
              <tbody>
                {days.map((d) => {
                  const l = lineupOn(d.date);
                  if (!l) return <tr key={d.date}><th>{short(d.date)}</th><td colSpan={INSTRUMENTS.length}><Chip tone="dash">Not plotted yet</Chip></td></tr>;
                  return (
                    <tr key={d.date}>
                      <th>{short(d.date)}</th>
                      {INSTRUMENTS.map((inst) => {
                        const on = l.musicians.filter((m) => m.instrument === inst);
                        return (
                          <td key={inst}>
                            {on.length ? on.map((m) => (
                              <span key={m.name} style={{ display: 'block' }}>
                                {m.name === me.name ? <span className="rh-me">You</span> : isOut(m) ? <s>{firstOf(m.name)}</s> : firstOf(m.name)}
                              </span>
                            )) : <Chip tone="warn">None yet</Chip>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="rh-note">A crossed-out name is excused or has asked for a sub.</p>
        </Card>
      ) },
      history.musicians.length > 0 && { span: 5, node: (span) => (
        <Card key="musicians" span={span} id="rh-musicians" title="Sundays each musician plays" sub="Last 3 months and the next 6 weeks · keep it even">
          <Rows rows={history.musicians.map((s) => ({ key: s.name, name: s.name, me: s.name === me.name, value: s.count, pct: pct(s.count, history.musicians[0].count) }))} />
        </Card>
      ) },
    ]);
  }

  // Head Dancer: the dancers on the next dates, and the fast songs coming up.
  if (me.headDancer) {
    const fastSongs = lineups.flatMap((l) => l.songs.filter((s) => s.type === 'Fast').map((s) => ({ ...s, date: l.date })));
    rows.push([
      { span: 7, node: (span) => (
        <Card key="dancers" span={span} id="rh-dancers" title="The dancers, the next Sundays" sub="Who dances on each date">
          <div className="ao-scroll">
            <table className="ao-table rh-table">
              <thead><tr><th>Date</th><th>Dancers</th><th className="r">On</th></tr></thead>
              <tbody>
                {days.map((d) => {
                  const l = lineupOn(d.date);
                  if (!l) return <tr key={d.date}><th>{short(d.date)}</th><td colSpan={2}><Chip tone="dash">Not plotted yet</Chip></td></tr>;
                  const here = l.dancers.filter((p) => !isOut(p)).length;
                  return (
                    <tr key={d.date}>
                      <th>{short(d.date)}</th>
                      <td>{l.dancers.length ? l.dancers.map((p, i) => <span key={p.name}>{i ? ', ' : ''}{p.name === me.name ? <span className="rh-me">You</span> : isOut(p) ? <s>{p.name}</s> : p.name}</span>) : <Chip tone="warn">None yet</Chip>}</td>
                      <td className="r">{here}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) },
      { span: 5, node: (span) => (
        <Card key="fast" span={span} id="rh-fast" title="Fast songs coming up" sub="What the team dances next">
          {fastSongs.length ? (
            <List items={fastSongs.slice(0, 6).map((s, i) => ({ key: `${s.date}-${i}`, icon: 'fa-music', title: s.title, sub: `${short(s.date)}${s.danced ? ` · danced ${plural(s.danced, 'time')} before` : ''}`, end: s.danced ? <Chip tone="good">Danced before</Chip> : <Chip tone="warn">New to the team</Chip> }))} />
          ) : <Empty icon="fa-music" title="No fast songs yet">They show here once the song leaders add them.</Empty>}
        </Card>
      ) },
    ]);
    if (history.dancers.length) {
      rows.push([
        { span: 12, node: (span) => (
          <Card key="dancefair" span={span} id="rh-dancefair" title="Sundays each dancer serves" sub="Last 3 months and the next 6 weeks · keep it even">
            <Rows rows={history.dancers.map((s) => ({ key: s.name, name: s.name, me: s.name === me.name, value: s.count, pct: pct(s.count, history.dancers[0].count) }))} />
          </Card>
        ) },
      ]);
    }
  }

  // Media team: lyrics, then (Media Head) coverage, recordings and the team.
  if (media) {
    const next = media.coverage.find((c) => c.songs.length);
    rows.push([
      { span: 7, node: (span) => (
        <Card key="needing" span={span} id="rh-needing" title="Songs needing lyrics" sub="In a coming lineup, not yet in the lyrics library" more={page('lyrics') && { label: 'Lyrics library', onClick: page('lyrics') }}>
          {media.needing.length ? (
            <List items={media.needing.slice(0, 6).map((s, i) => ({ key: `${s.date}-${i}`, icon: 'fa-align-left', title: s.title, sub: `${short(s.date)}${s.leader ? ` · ${s.leader} leads` : ''} · ${s.type.toLowerCase()} song`, end: page('lyrics') ? <button type="button" className="rh-mini" onClick={page('lyrics')}>Add lyrics</button> : null }))} />
          ) : (
            <Empty icon="fa-circle-check" title={media.coverage.some((c) => c.songs.length) ? 'Every song has lyrics' : 'No songs in the coming lineups yet'}>
              {media.coverage.some((c) => c.songs.length) ? 'All the songs in the coming lineups are in the library.' : 'Songs show here as soon as the song leaders add them.'}
            </Empty>
          )}
        </Card>
      ) },
      { span: 5, node: (span) => (
        <Card key="nextsongs" span={span} id="rh-nextsongs" title={next ? `Lyrics for ${whenWord(today, next.date).toLowerCase() === 'tomorrow' ? 'tomorrow' : short(next.date)}` : 'Lyrics for the next service'} sub="Ready for the screen?">
          {next ? (
            <List items={next.songs.map((s, i) => ({ key: i, icon: 'fa-music', title: s.title, sub: `${s.type} song`, end: s.ready ? <Chip tone="good">Ready</Chip> : <Chip tone="bad">Missing</Chip> }))} />
          ) : <Empty icon="fa-music" title="No songs yet">The next lineup has no songs yet.</Empty>}
        </Card>
      ) },
    ]);
    const recordingsCard = { span: 6, node: (span) => (
      <Card key="recs" span={span} id="rh-recs" title="Recordings" sub={media.recordingsThisYear != null ? `${plural(media.recordingsThisYear, 'recording')} this year` : 'The latest'} more={page('recordings') && { label: 'Recordings', onClick: page('recordings') }}>
        {media.recordings.length ? (
          <List items={[
            ...(media.lastSundayRecorded === false && media.lastSunday ? [{ key: 'last', icon: 'fa-video', title: day(media.lastSunday, { weekday: 'long', month: 'short', day: 'numeric' }), sub: 'No recording yet', end: <Chip tone="warn">To upload</Chip> }] : []),
            ...media.recordings.slice(0, 4).map((r) => ({ key: r.id, icon: 'fa-video', title: r.title, sub: [r.date && day(r.date, { month: 'short', day: 'numeric', year: 'numeric' }), r.by && `by ${r.by}`].filter(Boolean).join(' · '), end: <Chip tone="good">Uploaded</Chip> })),
          ]} />
        ) : <Empty icon="fa-video" title="No recordings yet">Service recordings show here once uploaded.</Empty>}
      </Card>
    ) };
    const addedCard = { span: 6, node: (span) => (
      <Card key="added" span={span} id="rh-added" title="Lyrics added by month" sub={`Last 6 months · ${plural(media.libraryCount, 'song')} in the library`}>
        <Cols cols={media.addedByMonth.map((m) => ({ key: m.month, label: monthShort(m.month), value: m.count }))} />
      </Card>
    ) };
    if (me.mediaHead) {
      rows.push([
        { span: 6, node: (span) => (
          <Card key="coverage" span={span} id="rh-coverage" title="Lyrics ready by date" sub="Songs in each coming lineup that have lyrics">
            {media.coverage.some((c) => c.songs.length) ? (
              <Rows rows={media.coverage.filter((c) => c.songs.length).map((c) => {
                const ready = c.songs.filter((s) => s.ready).length;
                return { key: c.date, name: short(c.date), value: `${ready} of ${c.songs.length}`, pct: pct(ready, c.songs.length) };
              })} />
            ) : <Empty icon="fa-music" title="No songs in the coming lineups yet">Each date shows here once it has songs.</Empty>}
          </Card>
        ) },
        recordingsCard,
      ]);
      rows.push([
        media.team && { span: 6, node: (span) => (
          <Card key="team" span={span} id="rh-team" title="Media team" sub={`${plural(media.teamSize || 0, 'member')}, by position`}>
            <List items={media.team.map((g) => ({ key: g.position, icon: POSITION_ICONS[g.position] || 'fa-user', title: g.position, sub: g.names.map((n) => (n === me.name ? `${n} (you)` : n)).join(', ') }))} />
          </Card>
        ) },
        addedCard,
      ]);
    } else {
      rows.push([addedCard, recordingsCard]);
    }
  }

  // Ushers: services and the events they usher; a Head Usher, the team.
  if (ushers) {
    const coming = [
      ...sundaysAhead.slice(0, 2).map((d) => ({ when: d.date, key: `s-${d.date}`, icon: 'fa-sun', title: 'Worship Service', sub: `${day(d.date, { weekday: 'long', month: 'short', day: 'numeric' })} · 9:00 AM`, end: <Chip>{whenWord(today, d.date)}</Chip> })),
      ...ushers.mine.map((e) => ({ when: String(e.date).slice(0, 10), key: `e-${e.id}`, icon: 'fa-calendar-check', title: e.title, sub: eventDay(e.date), end: <Chip tone="gold">Usher</Chip> })),
    ].sort((a, b) => a.when.localeCompare(b.when)).slice(0, 6);
    rows.push([
      { span: 7, node: (span) => (
        <Card key="coming" span={span} id="rh-coming" title="Coming up" sub="Services, and the events you usher" more={page('events') && { label: 'All events', onClick: page('events') }}>
          <List items={coming} />
        </Card>
      ) },
      { span: 5, node: (span) => (
        <Card key="mychecks" span={span} id="rh-mychecks" title="My check-ins by month" sub="Last 6 months">
          <Cols cols={checkins.byMonth.map((m) => ({ key: m.month, label: monthShort(m.month), value: m.count }))} />
        </Card>
      ) },
    ]);
    if (me.headUsher) {
      rows.push([
        ushers.events && { span: 6, node: (span) => (
          <Card key="evushers" span={span} id="rh-evushers" title="Events and ushers" sub="Ushers on each event committee" more={page('events') && { label: 'All events', onClick: page('events') }}>
            {ushers.events.length ? (
              <List items={ushers.events.map((e) => ({ key: e.id, icon: 'fa-calendar-check', title: e.title, sub: eventDay(e.date), end: e.ushers ? <Chip tone="good">{plural(e.ushers, 'usher')}</Chip> : <Chip tone="warn">None yet</Chip> }))} />
            ) : <Empty icon="fa-calendar" title="No events coming up">Events show here once they are published.</Empty>}
          </Card>
        ) },
        ushers.perSunday && { span: 6, node: (span) => (
          <Card key="persunday" span={span} id="rh-persunday" title="Ushers at each Sunday" sub={`Last ${ushers.sundays} Sundays, of ${plural(ushers.teamSize || 0, 'usher')}`}>
            <Cols cols={ushers.perSunday.map((s) => ({ key: s.date, label: day(s.date, { month: 'short', day: 'numeric' }), value: s.count }))} />
          </Card>
        ) },
      ]);
      if (ushers.team?.length) {
        rows.push([
          { span: 12, node: (span) => (
            <Card key="perusher" span={span} id="rh-perusher" title="Check-ins per usher" sub={`Last ${ushers.sundays} Sundays`}>
              <Rows rows={ushers.team.map((u) => ({ key: u.name, name: u.name, me: u.name === me.name, value: `${u.count} of ${ushers.sundays}`, pct: pct(u.count, ushers.sundays) }))} />
            </Card>
          ) },
        ]);
      }
    }
  }

  // A Ministry Member whose ministry and positions were never saved.
  if (!rows.length) {
    rows.push([
      { span: 12, node: (span) => (
        <Card key="setup" span={span} id="rh-setup" title="Your ministry" sub="What you serve as">
          <Empty icon="fa-user-gear" title="Your ministry roles are not set up yet">
            Once the church office adds your ministry and position (for example Backup Singer, Keyboard or Usher), your lineups, Sundays and requests show here.
          </Empty>
        </Card>
      ) },
    ]);
  }

  const pills = me.positions.slice(0, me.positions.length > 4 ? 3 : 4).map((p) => ({ label: p, icon: POSITION_ICONS[p] || 'fa-user' }));
  if (me.positions.length > 4) pills.push({ label: `+${me.positions.length - 3} more`, icon: 'fa-plus' });

  return (
    <div className={`ao rh${intro ? ' ao-intro' : ''}`}>
      <Head name={name} pills={pills} />
      <Shortcuts items={shortcuts} />
      <Attention items={tiles} />
      <Kpis items={kpis} />
      <Grid rows={rows} />
      <Verse verse={verse} />
    </div>
  );
}

// The next lineup they are on: date, practice, songs and the team.
function NextLineup({ l, me, today, unplotted, page }) {
  if (!l) {
    return unplotted
      ? <Empty icon="fa-calendar-plus" title="Not plotted yet">Your next lineup shows here, with its songs and team, once the Schedule Plotter plots it.</Empty>
      : <Empty icon="fa-mug-hot" title="You are resting the next Sundays">When you are on a lineup, its songs and team show here. You can still take an open sub.</Empty>;
  }
  const leading = l.songLeader?.name === me.name;
  const meta = [
    ['fa-church', new Date(`${l.date}T00:00:00Z`).getUTCDay() === 0 ? 'Service 9:00 AM' : 'Service day'],
    l.practiceDate && ['fa-music', `Practice ${whenWord(today, l.practiceDate).toLowerCase().startsWith('to') ? whenWord(today, l.practiceDate).toLowerCase() : whenWord(today, l.practiceDate)}${l.practiceTime ? ` · ${clock(l.practiceTime)}` : ''}`],
  ].filter(Boolean);
  const dancerNote = me.dancer && !me.songLeader;
  return (
    <>
      <div className="rh-nx-head">
        <div>
          <b className="rh-nx-date">{day(l.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b>
          <span>{inDays(today, l.date).replace(/^./, (c) => c.toUpperCase())}{l.myParts.length ? ` · ${leading ? 'you lead' : l.myParts.join(', ')}` : ''}</span>
        </div>
        <div className="rh-nx-meta">{meta.map(([icon, text]) => <span key={text}><i className={`fas ${icon}`} aria-hidden="true"></i>{text}</span>)}</div>
      </div>
      {l.songs.length ? (
        <div className="ao-scroll">
          <table className="ao-table rh-table">
            <thead><tr><th>Song</th><th>Type</th><th className="r"></th></tr></thead>
            <tbody>
              {l.songs.map((s, i) => (
                <tr key={`${s.title}-${i}`}>
                  <td>{s.link ? <a href={s.link} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}</td>
                  <td>{s.type}</td>
                  <td className="r">
                    {dancerNote
                      ? (s.type === 'Fast' ? <Chip tone={s.danced ? 'gold' : 'warn'}>{s.danced ? 'Dance' : 'New dance'}</Chip> : <Chip>No dance</Chip>)
                      : s.newToMe ? <Chip tone="warn">New to you</Chip> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon="fa-music" title={leading ? 'Add your songs' : 'No songs yet'}>
          {leading ? 'Your team learns the songs from here, so add them early.' : 'The song leader has not added the songs yet.'}
        </Empty>
      )}
      <div className="rh-crew">
        <div><small>Song leader</small>{l.songLeader ? <Who p={l.songLeader} me={me.name} /> : '—'}</div>
        <div><small>Backup</small>{l.backupSingers.length ? l.backupSingers.map((p) => <Who key={p.name} p={p} me={me.name} />) : '—'}</div>
        <div><small>Band</small>{l.musicians.length ? l.musicians.map((p) => <Who key={`${p.name}-${p.instrument}`} p={p} me={me.name} extra={p.instrument.toLowerCase()} />) : '—'}</div>
        {l.dancers.length > 0 && <div><small>Dancers</small>{l.dancers.map((p) => <Who key={p.name} p={p} me={me.name} />)}</div>}
      </div>
      {leading && page('addSongs') ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="ao-link" onClick={page('addSongs')}>{l.songs.length ? 'Edit the songs' : 'Add songs'} <i className="fas fa-chevron-right" aria-hidden="true"></i></button></div>
      ) : page('playlist') && l.songs.length > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="ao-link" onClick={page('playlist')}>Open the song playlist <i className="fas fa-chevron-right" aria-hidden="true"></i></button></div>
      ) : null}
    </>
  );
}

/**
 * @param {string}   userId     the signed-in account
 * @param {string}   firstname  for the greeting while the numbers load
 * @param {boolean}  active     Home is the open section (refreshes only then)
 * @param {Function} canOpen    may this account open a section?
 * @param {Function} go         open a section: go('weekly-schedule')
 * @param {Function} openTab    open a section on a tab: openTab('praise-worship', { pawTab: 'lyrics-library' })
 * @param {object}   verse      the verse of the day: { verse, reference }
 */
export default function MinistryOverview({ userId, firstname, active, canOpen, go, openTab, verse }) {
  const [data, setData] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [res, meet] = await Promise.all([
        fetch(`/api/home/ministry?actorId=${encodeURIComponent(userId)}`, { cache: 'no-store' }),
        fetch(`/api/meetings?actorId=${encodeURIComponent(userId)}&view=upcoming`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ]);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || 'Could not load your Home. Please try again.');
      setData(json.data);
      setMeetings(Array.isArray(meet?.data) ? meet.data : []);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load your Home. Please try again.');
    }
  }, [userId]);

  useSmartPoll(load, POLL_MS.roleHome, { enabled: !!active && !!userId });

  return (
    <MinistryOverviewView data={data} meetings={meetings} error={data ? '' : error} onRetry={load}
      firstname={firstname} canOpen={canOpen} go={go} openTab={openTab} verse={verse} />
  );
}
