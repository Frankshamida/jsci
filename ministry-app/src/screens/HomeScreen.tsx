import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../session';
import { useAppNav } from '../routes';
import { songCount, upcomingMine } from '../lineups';
import { Avatar, Banner, Button, Card, Chip, ChoiceRow, EmptyState, Screen, SectionTitle } from '../components';
import { colors, font, partColor, radius, space } from '../theme';
import { dayOfMonth, firstName, greeting, longDate, relativeDay, weekday } from '../utils';
import { verseOfTheDay } from '../verses';
import type { Lineup } from '../types';

type ScheduleView = 'Mine' | 'Team';
const VIEWS: ScheduleView[] = ['Mine', 'Team'];

export default function HomeScreen() {
  const { home, profile, refresh, refreshing, loadError, lastUpdated } = useSession();
  const nav = useAppNav();
  const [view, setView] = useState<ScheduleView>('Mine');
  const verse = verseOfTheDay();

  if (!home || !profile) {
    return (
      <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
        {loadError ? <Banner tone="danger" text={loadError} /> : <EmptyState icon="hourglass-outline" title="Loading your schedule…" />}
        {loadError && <Button title="Try again" onPress={() => refresh(true)} />}
      </Screen>
    );
  }

  const upcoming = upcomingMine(home);
  const next = upcoming[0];
  const past = home.assignments.filter((l) => l.date < home.today).slice(-3).reverse();
  const open = (l: Lineup) => nav.navigate('Lineup', { scheduleId: l.scheduleId });

  return (
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      {/* Greeting */}
      <View style={s.greetRow}>
        <Avatar name={profile.fullName} picture={profile.profilePicture} size={56} ring={colors.gold} />
        <View style={s.flex}>
          <Text style={s.greet}>{greeting()},</Text>
          <Text style={s.name}>{profile.firstname}! 🙌</Text>
        </View>
      </View>
      <View style={s.chips}>
        {profile.ministries.filter((m) => m.key !== 'plotter').map((m) => <Chip key={m.label} label={m.label} />)}
      </View>

      <View style={s.verse}>
        <Ionicons name="book-outline" size={16} color={colors.goldLight} />
        <View style={s.flex}>
          <Text style={s.verseText}>“{verse.text}”</Text>
          <Text style={s.verseRef}>— {verse.ref}</Text>
        </View>
      </View>

      {loadError && <Banner tone="warn" text={`Showing saved data. ${loadError}`} />}

      {home.openSubs.length > 0 && (
        <Card onPress={() => nav.navigate('Requests')} style={s.openSubs}>
          <Ionicons name="hand-left-outline" size={22} color={colors.info} />
          <View style={s.flex}>
            <Text style={s.openSubsTitle}>{home.openSubs.length} teammate{home.openSubs.length === 1 ? '' : 's'} need{home.openSubs.length === 1 ? 's' : ''} a substitute</Text>
            <Text style={s.muted}>Tap to see if you can cover.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Card>
      )}

      {/* Next Sunday they serve */}
      <SectionTitle title="Next up" />
      {next ? (
        <Card onPress={() => open(next)} style={s.next}>
          <Text style={s.nextWhen}>{relativeDay(next.date, home.today)}</Text>
          <Text style={s.nextDate}>{longDate(next.date)}</Text>
          <View style={s.chips}>{next.myParts.map((p) => <Chip key={p} label={p} color={partColor(p)} solid />)}</View>
          <Text style={s.muted}>
            {next.isSongLeader
              ? (songCount(next) ? `Your ${songCount(next)} songs are set.` : 'You are leading. Add your songs for the team.')
              : `${next.songLeader ? `Led by ${next.songLeader.name}. ` : ''}${songCount(next) ? `${songCount(next)} songs in the lineup.` : 'Waiting for the songs.'}`}
          </Text>
          <View style={s.nextActions}>
            {next.isSongLeader && (
              <Button compact title={songCount(next) ? 'Edit Songs' : 'Add Songs'} icon="musical-notes" onPress={() => nav.navigate('SongEditor', { scheduleId: next.scheduleId })} />
            )}
            <Button compact variant="secondary" title="View Lineup" icon="eye-outline" onPress={() => open(next)} />
          </View>
        </Card>
      ) : (
        <Card><EmptyState icon="calendar-outline" title="Nothing scheduled yet" text="When the plotter puts you on a lineup, it shows up here." /></Card>
      )}

      {/* Their schedule, or the whole team's */}
      <SectionTitle title="Schedule" />
      <ChoiceRow options={VIEWS} value={view} onChange={setView} labels={{ Mine: 'My Schedule', Team: 'Team Lineups' }} />
      {(view === 'Mine' ? upcoming : home.team).map((l) => <LineupRow key={l.scheduleId} lineup={l} today={home.today} onPress={() => open(l)} />)}
      {view === 'Mine' && upcoming.length === 0 && <Text style={s.muted}>No upcoming dates.</Text>}
      {view === 'Team' && home.team.length === 0 && <Text style={s.muted}>No lineups plotted yet.</Text>}

      {view === 'Mine' && past.length > 0 && (
        <>
          <SectionTitle title="Earlier" />
          {past.map((l) => <LineupRow key={l.scheduleId} lineup={l} today={home.today} onPress={() => open(l)} faded />)}
        </>
      )}

      {lastUpdated && <Text style={s.updated}>Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · pull down to refresh</Text>}
    </Screen>
  );
}

function LineupRow({ lineup, today, onPress, faded }: { lineup: Lineup; today: string; onPress: () => void; faded?: boolean }) {
  const parts = lineup.subbedOut ? ['Subbed out'] : lineup.myParts;
  return (
    <Card onPress={onPress} style={[s.row, faded && s.faded]}>
      <View style={[s.dateBox, lineup.date === today && s.dateBoxToday]}>
        <Text style={s.dateDow}>{weekday(lineup.date)}</Text>
        <Text style={s.dateDay}>{dayOfMonth(lineup.date)}</Text>
      </View>
      <View style={s.flex}>
        <View style={s.chips}>
          {parts.length
            ? parts.map((p) => <Chip key={p} label={p} color={p === 'Subbed out' ? colors.textSecondary : partColor(p)} />)
            : <Text style={s.rowTeam}>{lineup.songLeader ? `Led by ${firstName(lineup.songLeader.name)}` : 'No Song Leader yet'}</Text>}
        </View>
        <Text style={s.rowMeta}>
          {[lineup.songLeader && parts.length ? `Leader: ${firstName(lineup.songLeader.name)}` : null,
            songCount(lineup) ? `${songCount(lineup)} songs` : 'No songs yet',
            `${lineup.backupSingers.length + lineup.musicians.length + lineup.dancers.length + (lineup.songLeader ? 1 : 0)} on`].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Card>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  greetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  greet: { color: colors.textSecondary, fontSize: font.md },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  verse: { flexDirection: 'row', gap: space.sm, backgroundColor: colors.goldMuted, borderRadius: radius.md, padding: space.md, marginVertical: space.md },
  verseText: { color: colors.text, fontSize: font.sm, fontStyle: 'italic', lineHeight: 19 },
  verseRef: { color: colors.goldLight, fontSize: font.xs, fontWeight: '700', marginTop: 4 },
  muted: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19 },
  openSubs: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: 'rgba(76,195,224,0.4)' },
  openSubsTitle: { color: colors.info, fontSize: font.md, fontWeight: '800' },
  next: { borderColor: colors.goldDark, backgroundColor: colors.cardRaised },
  nextWhen: { color: colors.goldLight, fontSize: font.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  nextDate: { color: colors.text, fontSize: font.xl, fontWeight: '900', marginBottom: 4 },
  nextActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  faded: { opacity: 0.6 },
  dateBox: { width: 50, height: 54, borderRadius: radius.md, backgroundColor: colors.goldMuted, alignItems: 'center', justifyContent: 'center' },
  dateBoxToday: { backgroundColor: colors.gold },
  dateDow: { color: colors.goldLight, fontSize: font.xs, fontWeight: '800', textTransform: 'uppercase' },
  dateDay: { color: colors.text, fontSize: font.xl, fontWeight: '900' },
  rowTeam: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  rowMeta: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
  updated: { color: colors.textMuted, fontSize: font.xs, textAlign: 'center', marginTop: space.lg },
});
