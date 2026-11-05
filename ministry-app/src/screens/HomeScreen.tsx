import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { useMonth } from '../months';
import { songCount, upcomingMine } from '../lineups';
import {
  Avatar, Banner, Button, Card, Chip, DateBox, EmptyState, Icon, MonthSwitcher, Screen, SectionTitle, Segmented, type IconName,
} from '../components';
import { useDialog } from '../dialog';
import { useRevealOnFocus } from '../keyboard';
import { APP_VERSION, DOWNLOAD_PAGE_URL, isNewerVersion } from '../config';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme, type Palette } from '../theme';
import { firstName, greeting, longDate, monthDay, monthLabel, parseYmd, relativeDay } from '../utils';
import { verseOfTheDay } from '../verses';
import type { Lineup, Member, MyDay, Person } from '../types';

type View2 = 'mine' | 'team';

export default function HomeScreen() {
  const { home, profile, refresh, loadError, lastUpdated, welcome, dismissWelcome } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const nav = useAppNav();
  const dialog = useDialog();
  const verse = verseOfTheDay();
  const thisMonth = (home?.today || '').slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [view, setView] = useState<View2>('mine');
  const [query, setQuery] = useState('');
  const shown = useMonth(month || thisMonth);

  // A new day can start a new month while the app stays open.
  useEffect(() => { if (thisMonth && !month) setMonth(thisMonth); }, [thisMonth, month]);

  // Just signed in: a warm hello, with what is coming up for them.
  useEffect(() => {
    if (!welcome || !home || !profile) return;
    dismissWelcome();
    const first = upcomingMine(home)[0];
    dialog.alert({
      icon: 'hands-praying',
      title: `Welcome, ${profile.firstname}!`,
      message: first
        ? `You are ${first.myParts.join(' & ')} ${relativeDay(first.date, home.today).toLowerCase()} (${longDate(first.date)}). God bless your ministry!`
        : 'You are not on a lineup yet. When the plotter adds you, it shows up here. God bless your ministry!',
      confirmText: "Let's go",
    });
  }, [welcome, home, profile, dismissWelcome, dialog]);

  // The navigator shows the loading screen until the dashboard is in.
  if (!home || !profile) return null;

  const latest = home.latestApp;
  const update = latest && isNewerVersion(latest.version, APP_VERSION) ? latest : null;
  const next = upcomingMine(home)[0];
  const swapsForMe = home.swapsForMe || [];
  const data = shown.data;
  const open = (scheduleId: string | null) => { if (scheduleId) nav.navigate('Lineup', { scheduleId }); };

  return (
    <Screen onRefresh={() => Promise.all([refresh(true), month !== thisMonth ? shown.reload() : null])}>
      {/* Welcome, in the website's welcome-card style */}
      <LinearGradient colors={c.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.glow} />
        <View style={s.heroTop}>
          <Text style={s.heroKicker}>{greeting().toUpperCase()}</Text>
          <View style={s.heroMonth}>
            <Icon name="calendar-days" size={11} color={c.accent} />
            <Text style={s.heroMonthText}>{monthLabel(thisMonth)}</Text>
          </View>
        </View>
        <View style={s.heroRow}>
          <Avatar name={profile.fullName} picture={profile.profilePicture} size={58} ring={c.accent} />
          <View style={s.flex}>
            <Text style={s.heroName} numberOfLines={1}>{profile.firstname}!</Text>
            <Text style={s.heroDate}>{longDate(home.today)}</Text>
            <View style={s.chips}>
              {profile.ministries.filter((m) => m.key !== 'plotter').map((m) => (
                <View key={m.label} style={s.heroChip}><Text style={s.heroChipText}>{m.label}</Text></View>
              ))}
            </View>
          </View>
        </View>
        <View style={s.verse}>
          <Icon name="book-bible" size={13} color={c.accent} style={s.verseIcon} />
          <View style={s.flex}>
            <Text style={s.verseText}>“{verse.text}”</Text>
            <Text style={s.verseRef}>— {verse.ref}</Text>
          </View>
        </View>
      </LinearGradient>

      {loadError && <Banner tone="warn" text={`Showing saved data. ${loadError}`} />}

      {update && (
        <Notice icon="cloud-arrow-up" color={c.goldText} title={`Version ${update.version} is out`} text="Tap to download the new JSCI Ministry app."
          onPress={() => Linking.openURL(DOWNLOAD_PAGE_URL)} />
      )}
      {profile.canPlot && (
        <Notice icon="calendar-check" color={c.goldText} title="Schedule Plotter"
          text={home.pendingApprovals ? `${home.pendingApprovals} request${home.pendingApprovals === 1 ? '' : 's'} waiting for your approval` : 'Plot lineups and review requests'}
          badge={home.pendingApprovals || 0}
          onPress={() => nav.navigate('Planner', home.pendingApprovals ? { tab: 'approvals' } : undefined)} />
      )}
      {swapsForMe.length > 0 && (
        <Notice icon="right-left" color={c.band} title={`${firstName(swapsForMe[0].requesterName)} asks to swap with you`}
          text={swapsForMe.length > 1 ? `${swapsForMe.length} swap requests are waiting for your answer` : `${swapsForMe[0].part}: ${monthDay(swapsForMe[0].partnerDate)} ⇄ ${monthDay(swapsForMe[0].requesterDate)}`}
          onPress={() => nav.navigate('Requests')} />
      )}
      {home.openSubs.length > 0 && (
        <Notice icon="people-arrows" color={c.info}
          title={`${home.openSubs.length} teammate${home.openSubs.length === 1 ? '' : 's'} need${home.openSubs.length === 1 ? 's' : ''} a substitute`}
          text="Tap to see if you can cover." onPress={() => nav.navigate('Requests')} />
      )}

      {/* The next Sunday they serve */}
      <SectionTitle title="Next up" icon="calendar-check" />
      {next ? (
        <Card onPress={() => open(next.scheduleId)} raised>
          <View style={s.nextRow}>
            <DateBox date={next.date} today={home.today} />
            <View style={s.flex}>
              <Text style={s.nextWhen}>{relativeDay(next.date, home.today)}</Text>
              <Text style={s.nextDate}>{longDate(next.date)}</Text>
              <View style={s.chips}>{next.myParts.map((p) => <Chip key={p} label={p} color={partColor(c, p)} solid />)}</View>
            </View>
          </View>
          {next.songLeader && !next.isSongLeader && <LedBy name={next.songLeader.name} />}
          <Text style={s.muted}>
            {next.isSongLeader
              ? (songCount(next) ? `Your ${songCount(next)} songs are set.` : 'You are leading. Add your songs for the team.')
              : (songCount(next) ? `${songCount(next)} songs in the lineup.` : 'Waiting for the songs.')}
            {next.practiceDate ? `  ·  Practice ${monthDay(next.practiceDate)}${next.practiceTime ? `, ${next.practiceTime}` : ''}` : ''}
          </Text>
          <View style={s.nextActions}>
            {next.isSongLeader && (
              <Button compact title={songCount(next) ? 'Edit Songs' : 'Add Songs'} icon="music" onPress={() => nav.navigate('SongEditor', { scheduleId: next.scheduleId })} />
            )}
            <Button compact variant="secondary" title="View Lineup" icon="eye" onPress={() => open(next.scheduleId)} />
          </View>
        </Card>
      ) : (
        <Card><EmptyState icon="mug-hot" title="No upcoming lineup" text="You are resting for now. When the plotter puts you on a lineup, it shows up here." /></Card>
      )}

      {/* The month: a calendar, then their days or the team's lineups */}
      <SectionTitle title="Schedule" icon="calendar-days" />
      <MonthSwitcher month={month} onChange={(m) => { setMonth(m); }} current={thisMonth} loading={shown.loading && !shown.exact} />
      {shown.error && !shown.exact && <Banner tone="danger" text={shown.error} />}
      {data && <MonthCalendar month={month} days={shown.exact ? data.days : []} today={home.today} onOpen={open} />}

      <Segmented<View2>
        options={['mine', 'team']}
        value={view}
        onChange={setView}
        labels={{ mine: 'My Schedule', team: 'Team Lineups' }}
        icons={{ mine: 'user', team: 'users' }}
      />

      {!data || !shown.exact ? (
        <Card><Text style={s.muted}>{shown.error ? 'Could not load this month. Pull down to try again.' : `Loading ${monthLabel(month)}…`}</Text></Card>
      ) : view === 'mine' ? (
        <MySchedule days={data.days} today={home.today} onOpen={open} />
      ) : (
        <TeamLineups lineups={data.lineups} members={home.members || []} today={home.today} month={month}
          query={query} onQuery={setQuery} onOpen={open} onMember={(m) => nav.navigate('Member', { userId: m.id, name: m.name })} />
      )}

      {lastUpdated && <Text style={s.updated}>Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · pull down to refresh</Text>}
    </Screen>
  );
}

// ---- Pieces ----

function Notice({ icon, color, title, text, onPress, badge }: { icon: IconName; color: string; title: string; text: string; onPress: () => void; badge?: number }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <Card onPress={onPress} style={[s.notice, { borderColor: tint(color, 0.4) }]}>
      <View style={[s.roundIcon, { backgroundColor: tint(color, 0.14) }]}><Icon name={icon} size={16} color={color} /></View>
      <View style={s.flex}>
        <Text style={[s.noticeTitle, { color }]}>{title}</Text>
        <Text style={s.muted}>{text}</Text>
      </View>
      {badge ? <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View> : null}
      <Icon name="chevron-right" size={13} color={c.textMuted} />
    </Card>
  );
}

// "Led by Caroline Danal" - the name in bold gold, easy to spot.
export function LedBy({ name, small }: { name: string; small?: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.ledRow}>
      <Icon name="microphone" size={small ? 10 : 12} color={c.goldText} />
      <Text style={[s.ledBy, small && s.ledBySmall]}>Led by <Text style={s.ledName}>{name}</Text></Text>
    </View>
  );
}

// How a day reads: colour, label, icon.
function dayLook(c: Palette, d: MyDay): { color: string; label: string; icon: IconName } {
  if (d.state === 'covered') return { color: c.info, label: d.sub?.substituteName ? `Covered by ${firstName(d.sub.substituteName)}` : 'Covered', icon: 'people-arrows' };
  if (d.state === 'excused') return { color: c.danger, label: 'Excused', icon: 'calendar-xmark' };
  if (d.state === 'serving') return { color: c.secondary, label: 'Serving', icon: 'microphone' };
  if (d.state === 'rest') return { color: c.textSecondary, label: 'REST', icon: 'mug-hot' };
  return { color: c.textMuted, label: 'Not plotted yet', icon: 'hourglass-half' };
}

const pending = (d: MyDay) => d.excuse?.status === 'Pending' || ['Pending Admin', 'Open for Sub'].includes(d.sub?.status || '')
  || ['Waiting Partner', 'Pending Approval'].includes(d.swap?.status || '');

// A month at a glance: their days coloured by what they do; past days grey.
function MonthCalendar({ month, days, today, onOpen }: { month: string; days: MyDay[]; today: string; onOpen: (scheduleId: string | null) => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const byDate = useMemo(() => Object.fromEntries(days.map((d) => [d.date, d])), [days]);
  const first = parseYmd(`${month}-01`);
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  return (
    <Card style={s.calendar}>
      <View style={s.calRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={[s.calHead, i === 0 && { color: c.goldText }]}>{w}</Text>)}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={s.calRow}>
          {cells.slice(r * 7, r * 7 + 7).map((n, i) => {
            if (!n) return <View key={i} style={s.calCell} />;
            const date = `${month}-${String(n).padStart(2, '0')}`;
            const d = byDate[date];
            const past = date < today;
            const look = d ? dayLook(c, d) : null;
            const filled = d && (d.state === 'serving' || d.state === 'excused' || d.state === 'covered');
            return (
              <Pressable key={i} style={[s.calCell, past && s.calPast]} disabled={!d?.scheduleId} onPress={() => onOpen(d?.scheduleId || null)}
                accessibilityRole="button" accessibilityLabel={`${longDate(date)}${look ? `, ${look.label}` : ''}`}>
                <View style={[
                  s.calDay,
                  filled && { backgroundColor: look!.color },
                  d?.state === 'rest' && s.calRest,
                  date === today && s.calToday,
                  d && pending(d) && s.calPending,
                ]}>
                  <Text style={[s.calNum, filled && s.calNumOn, d?.state === 'rest' && s.calNumRest]}>{n}</Text>
                </View>
                {d?.state === 'rest' ? <Text style={s.calTag}>REST</Text> : d?.state === 'unplotted' ? <View style={s.calDot} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={s.legend}>
        {[[c.secondary, 'Serving'], [c.textSecondary, 'Rest'], [c.danger, 'Excused'], [c.info, 'Covered'], [c.warning, 'Pending']].map(([color, label]) => (
          <View key={label} style={s.legendItem}><View style={[s.legendDot, { backgroundColor: color }]} /><Text style={s.legendText}>{label}</Text></View>
        ))}
      </View>
    </Card>
  );
}

// Their days this month, each with what they do (or REST).
function MySchedule({ days, today, onOpen }: { days: MyDay[]; today: string; onOpen: (scheduleId: string | null) => void }) {
  if (!days.length) return <Card><EmptyState icon="calendar" title="Nothing this month" /></Card>;
  return <>{days.map((d) => <DayRow key={d.date} day={d} today={today} onPress={() => onOpen(d.scheduleId)} />)}</>;
}

function DayRow({ day: d, today, onPress }: { day: MyDay; today: string; onPress: () => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const look = dayLook(c, d);
  const past = d.date < today;
  const tags: { label: string; color: string; icon?: IconName }[] = [];
  if (d.excuse?.status === 'Pending') tags.push({ label: 'Excuse pending', color: c.warning, icon: 'hourglass-half' });
  if (d.sub?.status === 'Pending Admin') tags.push({ label: 'Sub request: waiting for approval', color: c.warning, icon: 'hourglass-half' });
  if (d.sub?.status === 'Open for Sub') tags.push({ label: 'Sub request: open to teammates', color: c.info, icon: 'people-arrows' });
  if (d.swap && ['Waiting Partner', 'Pending Approval'].includes(d.swap.status)) {
    tags.push({ label: `Swap with ${firstName(d.swap.otherName)} (${monthDay(d.swap.otherDate)}): ${d.swap.status === 'Waiting Partner' ? 'waiting for them' : 'waiting for approval'}`, color: c.warning, icon: 'right-left' });
  }
  if (d.swap?.status === 'Approved') tags.push({ label: `Swapped with ${firstName(d.swap.otherName)} (${monthDay(d.swap.otherDate)})`, color: c.band, icon: 'right-left' });
  if (d.covering) tags.push({ label: `Covering for ${d.covering}`, color: c.info, icon: 'user-check' });
  if (d.attendance) tags.push({ label: d.attendance, color: d.attendance === 'Present' ? c.success : d.attendance === 'Late' ? c.warning : d.attendance === 'Absent' ? c.danger : c.info, icon: 'clipboard-check' });

  return (
    <Card onPress={d.scheduleId ? onPress : undefined} style={[s.row, past && s.faded]}>
      <DateBox date={d.date} today={today} />
      <View style={s.flex}>
        {d.state === 'serving' ? (
          <View style={s.chips}>{d.parts.map((p) => <Chip key={p} label={p} color={partColor(c, p)} solid />)}</View>
        ) : (
          <View style={s.stateRow}>
            <Icon name={look.icon} size={13} color={look.color} />
            <Text style={[s.stateText, { color: look.color }, d.state === 'rest' && s.restText]}>{look.label}</Text>
          </View>
        )}
        {d.state === 'excused' && d.parts.length > 0 && <Text style={s.struck}>{d.parts.join(', ')}</Text>}
        {d.leader && d.state !== 'unplotted' && <LedBy name={d.leader} small />}
        {tags.map((t) => (
          <View key={t.label} style={s.tagRow}>
            {t.icon && <Icon name={t.icon} size={10} color={t.color} />}
            <Text style={[s.tagText, { color: t.color }]}>{t.label}</Text>
          </View>
        ))}
      </View>
      {d.scheduleId && <Icon name="chevron-right" size={13} color={c.textMuted} />}
    </Card>
  );
}

// "Backup: Ana, Ben" - the people of one part, first names, with the excused greyed.
function namesLine(people: Person[]) {
  return people.map((p) => firstName(p.name)).join(', ');
}

function TeamLineups({ lineups, members, today, month, query, onQuery, onOpen, onMember }: {
  lineups: Lineup[]; members: Member[]; today: string; month: string; query: string;
  onQuery: (q: string) => void; onOpen: (scheduleId: string | null) => void; onMember: (m: Member) => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const reveal = useRevealOnFocus();
  const q = query.trim().toLowerCase();
  const found = useMemo(() => (q ? members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8) : []), [q, members]);

  return (
    <>
      <View style={s.search}>
        <Icon name="magnifying-glass" size={14} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Search a teammate by name"
          placeholderTextColor={c.textMuted}
          style={s.searchInput}
          autoCorrect={false}
          returnKeyType="search"
          onFocus={reveal}
          selectionColor={c.secondary}
        />
        {query ? <Pressable onPress={() => onQuery('')} hitSlop={10} accessibilityLabel="Clear search"><Icon name="circle-xmark" size={15} color={c.textMuted} /></Pressable> : null}
      </View>

      {q ? (
        found.length ? found.map((m) => <MemberResult key={m.id} member={m} lineups={lineups} today={today} month={month} onPress={() => onMember(m)} onOpen={onOpen} />)
          : <Card><EmptyState icon="user-slash" title="Nobody by that name" text="Check the spelling, or try a first name." /></Card>
      ) : lineups.length ? lineups.map((l) => (
        <Card key={l.scheduleId} onPress={() => onOpen(l.scheduleId)} style={[s.row, s.teamRow, l.date < today && s.faded]}>
          <DateBox date={l.date} today={today} />
          <View style={s.flex}>
            {l.songLeader ? <LedBy name={l.songLeader.name} /> : <Text style={s.muted}>No Song Leader yet</Text>}
            {l.backupSingers.length > 0 && <TeamLine label="Backup" text={namesLine(l.backupSingers)} />}
            {l.musicians.length > 0 && <TeamLine label="Band" text={l.musicians.map((m) => `${m.instrument} – ${firstName(m.name)}`).join(' · ')} />}
            {l.dancers.length > 0 && <TeamLine label="Dancers" text={namesLine(l.dancers)} />}
            <View style={s.teamFoot}>
              <Text style={s.teamMeta}>{songCount(l) ? `${songCount(l)} songs` : 'No songs yet'}</Text>
              {l.myParts.length > 0 && <Chip label={`You: ${l.myParts.join(', ')}`} color={partColor(c, l.myParts[0])} />}
              {l.myParts.length === 0 && l.date >= today && <Chip label="You: REST" color={c.textSecondary} />}
            </View>
          </View>
        </Card>
      )) : <Card><EmptyState icon="calendar" title={`No lineups in ${monthLabel(month)}`} text="The plotter has not made this month's lineups yet." /></Card>}
    </>
  );
}

function TeamLine({ label, text }: { label: string; text: string }) {
  const s = useStyles();
  return <Text style={s.teamLine} numberOfLines={2}><Text style={s.teamLabel}>{label}: </Text>{text}</Text>;
}

// A teammate found by name: who they are, then their dates this month.
function MemberResult({ member, lineups, today, month, onPress, onOpen }: {
  member: Member; lineups: Lineup[]; today: string; month: string; onPress: () => void; onOpen: (scheduleId: string | null) => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const key = member.name.toLowerCase();
  const dates = lineups.flatMap((l) => {
    const parts = [
      ...(l.songLeader?.name.toLowerCase() === key ? ['Song Leader'] : []),
      ...(l.backupSingers.some((p) => p.name.toLowerCase() === key) ? ['Backup Singer'] : []),
      ...l.musicians.filter((p) => p.name.toLowerCase() === key).map((p) => p.instrument),
      ...(l.dancers.some((p) => p.name.toLowerCase() === key) ? ['Dancer'] : []),
    ];
    return parts.length ? [{ l, parts }] : [];
  });
  const groups = member.groups.filter((g) => g.key !== 'plotter');
  return (
    <Card>
      <Pressable onPress={onPress} style={s.memberHead} accessibilityRole="button" accessibilityLabel={`${member.name}, see their history`}>
        <Avatar name={member.name} picture={member.picture} size={46} />
        <View style={s.flex}>
          <Text style={s.memberName}>{member.name}</Text>
          {groups.map((g) => (
            <Text key={g.label} style={s.memberRole} numberOfLines={2}>
              <Text style={s.memberRoleLabel}>{g.label}</Text>{g.positions.length ? `: ${g.positions.join(', ')}` : ''}
            </Text>
          ))}
          {member.groups.some((g) => g.key === 'plotter') && <Text style={s.memberRole}>Schedule Plotter</Text>}
        </View>
        <Icon name="chevron-right" size={13} color={c.textMuted} />
      </Pressable>
      <View style={s.memberDates}>
        <Text style={s.memberDatesTitle}>{monthLabel(month)}</Text>
        {dates.length ? dates.map(({ l, parts }) => (
          <Pressable key={l.scheduleId} onPress={() => onOpen(l.scheduleId)} style={[s.memberDate, l.date < today && s.faded]}>
            <Text style={s.memberDateText}>{monthDay(l.date)}</Text>
            <View style={s.chipsTight}>{parts.map((p) => <Chip key={p} label={p} color={partColor(c, p)} />)}</View>
          </Pressable>
        )) : <Text style={s.muted}>Not on a lineup this month (REST).</Text>}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  hero: { borderRadius: radius.xl, padding: space.lg, overflow: 'hidden', marginTop: space.sm, marginBottom: space.md },
  glow: { position: 'absolute', top: -70, right: -50, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(255, 195, 0, 0.12)' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  heroKicker: { color: 'rgba(255, 195, 0, 0.85)', fontSize: font.xs, fontFamily: fonts.semibold, letterSpacing: 1.4 },
  heroMonth: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: 'rgba(255, 195, 0, 0.14)' },
  heroMonthText: { color: '#FFD235', fontSize: font.xs, fontFamily: fonts.bold },
  heroDate: { color: 'rgba(255, 255, 255, 0.65)', fontSize: font.xs, fontFamily: fonts.medium },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  heroName: { color: '#ffffff', fontSize: font.xxl, fontFamily: fonts.bold },
  heroChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: 'rgba(255, 195, 0, 0.14)', borderWidth: 1, borderColor: 'rgba(255, 195, 0, 0.35)' },
  heroChipText: { color: '#FFD235', fontSize: font.xs, fontFamily: fonts.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  chipsTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 },
  verse: { flexDirection: 'row', gap: space.sm, marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  verseIcon: { marginTop: 3 },
  verseText: { color: 'rgba(255, 255, 255, 0.88)', fontSize: font.sm, fontFamily: fonts.regular, fontStyle: 'italic', lineHeight: 19 },
  verseRef: { color: c.accent, fontSize: font.xs, fontFamily: fonts.semibold, marginTop: 4 },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  roundIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  noticeTitle: { fontSize: font.md, fontFamily: fonts.bold },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#ffffff', fontSize: font.xs, fontFamily: fonts.bold },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nextWhen: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1.2 },
  nextDate: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  nextActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  ledRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 2 },
  ledBy: { color: c.textSecondary, fontSize: font.md, fontFamily: fonts.regular },
  ledBySmall: { fontSize: font.sm },
  ledName: { color: c.goldText, fontFamily: fonts.heavy },
  calendar: { paddingHorizontal: space.sm, paddingVertical: space.md },
  calRow: { flexDirection: 'row' },
  calHead: { flex: 1, textAlign: 'center', color: c.textMuted, fontSize: font.xs, fontFamily: fonts.bold, marginBottom: 4 },
  calCell: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2 },
  calPast: { opacity: 0.45 },
  calDay: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  calRest: { backgroundColor: tint(c.textSecondary, 0.14) },
  calToday: { borderColor: c.accent },
  calPending: { borderColor: c.warning, borderStyle: 'dashed' },
  calNum: { color: c.text, fontSize: font.sm, fontFamily: fonts.semibold },
  calNumOn: { color: '#ffffff', fontFamily: fonts.bold },
  calNumRest: { color: c.textSecondary },
  calTag: { color: c.textSecondary, fontSize: 7.5, fontFamily: fonts.heavy, letterSpacing: 0.5, marginTop: 1 },
  calDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.textMuted, marginTop: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md, marginTop: space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.medium },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  teamRow: { alignItems: 'flex-start' },
  faded: { opacity: 0.55 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 4 },
  stateText: { fontSize: font.md, fontFamily: fonts.bold },
  restText: { letterSpacing: 2, fontFamily: fonts.heavy },
  struck: { color: c.textMuted, fontSize: font.sm, fontFamily: fonts.medium, textDecorationLine: 'line-through' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  tagText: { fontSize: font.xs, fontFamily: fonts.semibold, flexShrink: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: c.input, borderWidth: 1, borderColor: c.border, borderRadius: radius.pill, paddingHorizontal: space.md, marginBottom: space.md },
  searchInput: { flex: 1, paddingVertical: 11, color: c.text, fontSize: font.md, fontFamily: fonts.regular },
  teamLine: { color: c.text, fontSize: font.sm, fontFamily: fonts.regular, marginTop: 3, lineHeight: 18 },
  teamLabel: { color: c.textSecondary, fontFamily: fonts.semibold },
  teamFoot: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  teamMeta: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.medium },
  memberHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  memberName: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  memberRole: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, marginTop: 1 },
  memberRoleLabel: { color: c.goldText, fontFamily: fonts.semibold },
  memberDates: { marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: c.border, gap: 6 },
  memberDatesTitle: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1 },
  memberDate: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 3 },
  memberDateText: { color: c.text, fontSize: font.sm, fontFamily: fonts.bold, width: 56 },
  updated: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.lg },
}));
