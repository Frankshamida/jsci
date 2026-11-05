import React, { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { songCount, upcomingMine } from '../lineups';
import { Avatar, Banner, Button, Card, Chip, ChoiceRow, EmptyState, Icon, LoadingView, Screen, SectionTitle } from '../components';
import { useDialog } from '../dialog';
import { APP_VERSION, DOWNLOAD_PAGE_URL, isNewerVersion } from '../config';
import { font, fonts, makeStyles, partColor, radius, space, tint, useTheme } from '../theme';
import { dayOfMonth, firstName, greeting, longDate, relativeDay, weekday } from '../utils';
import { verseOfTheDay } from '../verses';
import type { Lineup } from '../types';

type ScheduleView = 'Mine' | 'Team';
const VIEWS: ScheduleView[] = ['Mine', 'Team'];

export default function HomeScreen() {
  const { home, profile, refresh, refreshing, loadError, lastUpdated, welcome, dismissWelcome } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const nav = useAppNav();
  const dialog = useDialog();
  const [view, setView] = useState<ScheduleView>('Mine');
  const verse = verseOfTheDay();

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

  // The first load after signing in: one calm screen in the middle.
  if (!home || !profile) {
    if (!loadError) return <LoadingView message={refreshing ? 'Preparing your schedule…' : 'Loading…'} />;
    return (
      <Screen center onRefresh={() => refresh(true)}>
        <EmptyState icon="circle-exclamation" title="Could not load your schedule" text={loadError} />
        <Button title="Try again" icon="rotate-right" onPress={() => refresh(true)} />
      </Screen>
    );
  }

  const latest = home.latestApp;
  const update = latest && isNewerVersion(latest.version, APP_VERSION) ? latest : null;
  const upcoming = upcomingMine(home);
  const next = upcoming[0];
  const past = home.assignments.filter((l) => l.date < home.today).slice(-3).reverse();
  const open = (l: Lineup) => nav.navigate('Lineup', { scheduleId: l.scheduleId });

  return (
    <Screen onRefresh={() => refresh(true)}>
      {/* Welcome, in the website's welcome-card style */}
      <LinearGradient colors={c.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.glow} />
        <View style={s.heroTop}>
          <Text style={s.heroKicker}>{greeting().toUpperCase()}</Text>
          <Text style={s.heroDate}>{longDate(home.today)}</Text>
        </View>
        <View style={s.heroRow}>
          <Avatar name={profile.fullName} picture={profile.profilePicture} size={58} ring={c.accent} />
          <View style={s.flex}>
            <Text style={s.heroName} numberOfLines={1}>{profile.firstname}!</Text>
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
        <Card raised onPress={() => Linking.openURL(DOWNLOAD_PAGE_URL)} style={s.openSubs}>
          <View style={[s.roundIcon, { backgroundColor: c.goldMuted }]}><Icon name="cloud-arrow-up" size={16} color={c.goldText} /></View>
          <View style={s.flex}>
            <Text style={[s.openSubsTitle, { color: c.goldText }]}>Version {update.version} is out</Text>
            <Text style={s.muted}>Tap to download the new JSCI Ministry app.</Text>
          </View>
          <Icon name="chevron-right" size={13} color={c.textMuted} />
        </Card>
      )}

      {home.openSubs.length > 0 && (
        <Card onPress={() => nav.navigate('Requests')} style={s.openSubs}>
          <View style={[s.roundIcon, { backgroundColor: tint(c.info, 0.14) }]}><Icon name="people-arrows" size={16} color={c.info} /></View>
          <View style={s.flex}>
            <Text style={[s.openSubsTitle, { color: c.info }]}>{home.openSubs.length} teammate{home.openSubs.length === 1 ? '' : 's'} need{home.openSubs.length === 1 ? 's' : ''} a substitute</Text>
            <Text style={s.muted}>Tap to see if you can cover.</Text>
          </View>
          <Icon name="chevron-right" size={13} color={c.textMuted} />
        </Card>
      )}

      {/* The next Sunday they serve */}
      <SectionTitle title="Next up" icon="calendar-check" />
      {next ? (
        <Card onPress={() => open(next)} raised>
          <Text style={s.nextWhen}>{relativeDay(next.date, home.today)}</Text>
          <Text style={s.nextDate}>{longDate(next.date)}</Text>
          <View style={s.chips}>{next.myParts.map((p) => <Chip key={p} label={p} color={partColor(c, p)} solid />)}</View>
          <Text style={s.muted}>
            {next.isSongLeader
              ? (songCount(next) ? `Your ${songCount(next)} songs are set.` : 'You are leading. Add your songs for the team.')
              : `${next.songLeader ? `Led by ${next.songLeader.name}. ` : ''}${songCount(next) ? `${songCount(next)} songs in the lineup.` : 'Waiting for the songs.'}`}
          </Text>
          <View style={s.nextActions}>
            {next.isSongLeader && (
              <Button compact title={songCount(next) ? 'Edit Songs' : 'Add Songs'} icon="music" onPress={() => nav.navigate('SongEditor', { scheduleId: next.scheduleId })} />
            )}
            <Button compact variant="secondary" title="View Lineup" icon="eye" onPress={() => open(next)} />
          </View>
        </Card>
      ) : (
        <Card><EmptyState icon="calendar" title="Nothing scheduled yet" text="When the plotter puts you on a lineup, it shows up here." /></Card>
      )}

      {/* Their schedule, or the whole team's */}
      <SectionTitle title="Schedule" icon="calendar-week" />
      <ChoiceRow options={VIEWS} value={view} onChange={setView} labels={{ Mine: 'My Schedule', Team: 'Team Lineups' }} />
      {(view === 'Mine' ? upcoming : home.team).map((l) => <LineupRow key={l.scheduleId} lineup={l} today={home.today} onPress={() => open(l)} />)}
      {view === 'Mine' && upcoming.length === 0 && <Text style={s.muted}>No upcoming dates.</Text>}
      {view === 'Team' && home.team.length === 0 && <Text style={s.muted}>No lineups plotted yet.</Text>}

      {view === 'Mine' && past.length > 0 && (
        <>
          <SectionTitle title="Earlier" icon="clock" />
          {past.map((l) => <LineupRow key={l.scheduleId} lineup={l} today={home.today} onPress={() => open(l)} faded />)}
        </>
      )}

      {lastUpdated && <Text style={s.updated}>Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · pull down to refresh</Text>}
    </Screen>
  );
}

function LineupRow({ lineup, today, onPress, faded }: { lineup: Lineup; today: string; onPress: () => void; faded?: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const parts = lineup.subbedOut ? ['Subbed out'] : lineup.myParts;
  const isToday = lineup.date === today;
  return (
    <Card onPress={onPress} style={[s.row, faded && s.faded]}>
      {isToday ? (
        <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.dateBox}>
          <Text style={[s.dateDow, s.onGold]}>{weekday(lineup.date)}</Text>
          <Text style={[s.dateDay, s.onGold]}>{dayOfMonth(lineup.date)}</Text>
        </LinearGradient>
      ) : (
        <View style={[s.dateBox, s.dateBoxPlain]}>
          <Text style={s.dateDow}>{weekday(lineup.date)}</Text>
          <Text style={s.dateDay}>{dayOfMonth(lineup.date)}</Text>
        </View>
      )}
      <View style={s.flex}>
        <View style={s.chips}>
          {parts.length
            ? parts.map((p) => <Chip key={p} label={p} color={p === 'Subbed out' ? c.textSecondary : partColor(c, p)} />)
            : <Text style={s.rowTeam}>{lineup.songLeader ? `Led by ${firstName(lineup.songLeader.name)}` : 'No Song Leader yet'}</Text>}
        </View>
        <Text style={s.rowMeta}>
          {[lineup.songLeader && parts.length ? `Leader: ${firstName(lineup.songLeader.name)}` : null,
            songCount(lineup) ? `${songCount(lineup)} songs` : 'No songs yet',
            `${lineup.backupSingers.length + lineup.musicians.length + lineup.dancers.length + (lineup.songLeader ? 1 : 0)} on`].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Icon name="chevron-right" size={13} color={c.textMuted} />
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  hero: { borderRadius: radius.xl, padding: space.lg, overflow: 'hidden', marginTop: space.sm, marginBottom: space.md },
  glow: { position: 'absolute', top: -70, right: -50, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(255, 195, 0, 0.12)' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  heroKicker: { color: 'rgba(255, 195, 0, 0.85)', fontSize: font.xs, fontFamily: fonts.semibold, letterSpacing: 1.4 },
  heroDate: { color: 'rgba(255, 255, 255, 0.6)', fontSize: font.xs, fontFamily: fonts.medium },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  heroName: { color: '#ffffff', fontSize: font.xxl, fontFamily: fonts.bold },
  heroChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: 'rgba(255, 195, 0, 0.14)', borderWidth: 1, borderColor: 'rgba(255, 195, 0, 0.35)' },
  heroChipText: { color: '#FFD235', fontSize: font.xs, fontFamily: fonts.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  verse: { flexDirection: 'row', gap: space.sm, marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: 'rgba(255, 255, 255, 0.1)' },
  verseIcon: { marginTop: 3 },
  verseText: { color: 'rgba(255, 255, 255, 0.88)', fontSize: font.sm, fontFamily: fonts.regular, fontStyle: 'italic', lineHeight: 19 },
  verseRef: { color: c.accent, fontSize: font.xs, fontFamily: fonts.semibold, marginTop: 4 },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  openSubs: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: tint(c.info, 0.4) },
  roundIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  openSubsTitle: { fontSize: font.md, fontFamily: fonts.bold },
  nextWhen: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1.2 },
  nextDate: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold, marginBottom: 2 },
  nextActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  faded: { opacity: 0.6 },
  dateBox: { width: 50, height: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dateBoxPlain: { backgroundColor: c.goldMuted },
  dateDow: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase' },
  dateDay: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold },
  onGold: { color: '#ffffff' },
  rowTeam: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  rowMeta: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.regular, marginTop: 2 },
  updated: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.lg },
}));
