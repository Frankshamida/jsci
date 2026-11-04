import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSession } from '../session';
import { useLineup } from '../lineups';
import { useRecordings, invalidateRecordings } from '../recordings';
import { api } from '../api';
import type { StackProps } from '../routes';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Screen, SectionTitle, StatusBadge } from '../components';
import { colors, font, partColor, radius, space } from '../theme';
import { formatClock, longDate, relativeDay, shortDate, youtubeId, youtubeThumb } from '../utils';
import type { Person, Recording, Song } from '../types';

export default function LineupScreen({ route, navigation }: StackProps<'Lineup'>) {
  const { scheduleId } = route.params;
  const lineup = useLineup(scheduleId);
  const { home, profile, refresh, refreshing } = useSession();
  const recordings = useRecordings(scheduleId);

  useEffect(() => { if (lineup) navigation.setOptions({ title: shortDate(lineup.date) }); }, [lineup, navigation]);

  if (!lineup || !home || !profile) {
    return <Screen stacked><EmptyState icon="alert-circle-outline" title="Lineup not found" text="Pull down on Home to refresh, then try again." /></Screen>;
  }

  const past = lineup.date < home.today;
  const me = profile.fullName.toLowerCase();
  const isMe = (p: Person) => p.name.toLowerCase() === me;
  const myExcuse = home.excuses.find((e) => e.excuse_date === lineup.date && e.status !== 'Rejected');
  const mySub = home.substitutes.find((s) => s.date === lineup.date && s.requesterId === profile.id && s.status !== 'Rejected');
  const canAct = lineup.mine && !past && !lineup.subbedOut;

  return (
    <Screen stacked refreshing={refreshing} onRefresh={() => { refresh(true); recordings.reload(); }}>
      <Text style={s.when}>{relativeDay(lineup.date, home.today)}</Text>
      <Text style={s.date}>{longDate(lineup.date)}</Text>
      {lineup.myParts.length > 0 && (
        <View style={s.chips}>{lineup.myParts.map((p) => <Chip key={p} label={`You: ${p}`} color={partColor(p)} solid />)}</View>
      )}
      {lineup.subbedOut && <Banner tone="info" text={`A substitute is covering for you as Song Leader on this date.`} />}
      {lineup.practiceDate && (
        <Banner tone="info" icon="time-outline" text={`Practice: ${longDate(lineup.practiceDate)}${lineup.practiceTime ? ` at ${lineup.practiceTime}` : ''}`} />
      )}

      {/* Who is on */}
      <SectionTitle title="Team" />
      <Card>
        {lineup.songLeader && <PersonRow person={lineup.songLeader} part="Song Leader" me={isMe(lineup.songLeader)} />}
        {lineup.originalSongLeader && <Text style={s.subNote}>Substituting for {lineup.originalSongLeader}</Text>}
        {lineup.backupSingers.map((p) => <PersonRow key={`b-${p.name}`} person={p} part="Backup Singer" me={isMe(p)} />)}
        {lineup.musicians.map((p) => <PersonRow key={`m-${p.instrument}-${p.name}`} person={p} part={p.instrument} me={isMe(p)} />)}
        {lineup.dancers.map((p) => <PersonRow key={`d-${p.name}`} person={p} part="Dancer" me={isMe(p)} />)}
        {!lineup.songLeader && !lineup.backupSingers.length && !lineup.musicians.length && <Text style={s.muted}>Nobody plotted yet.</Text>}
      </Card>

      {/* Songs */}
      <SectionTitle
        title="Songs"
        action={lineup.isSongLeader && !past ? (lineup.slowSongs.length + lineup.fastSongs.length ? 'Edit' : 'Add') : undefined}
        onAction={() => navigation.navigate('SongEditor', { scheduleId })}
      />
      {lineup.slowSongs.length + lineup.fastSongs.length === 0 ? (
        <Card>
          <EmptyState
            icon="musical-notes-outline"
            title={lineup.isSongLeader ? 'Add the songs for your team' : 'No songs yet'}
            text={lineup.isSongLeader ? 'Your team sees them here as soon as you save.' : 'The Song Leader has not added the songs yet.'}
          />
          {lineup.isSongLeader && !past && <Button title="Add Songs" icon="add" onPress={() => navigation.navigate('SongEditor', { scheduleId })} />}
        </Card>
      ) : (
        <>
          <SongGroup title="Slow Songs" icon="leaf-outline" songs={lineup.slowSongs} />
          <SongGroup title="Fast Songs" icon="flash-outline" songs={lineup.fastSongs} />
        </>
      )}

      {/* Practice recordings */}
      <SectionTitle title="Practice Recordings" />
      <RecordingList
        list={recordings.list}
        error={recordings.error}
        loading={recordings.loading}
        myId={profile.id}
        onDeleted={() => { invalidateRecordings(scheduleId); recordings.reload(); }}
      />
      {lineup.mine && !lineup.subbedOut && (
        <Button title="Record or Upload Practice" icon="mic-outline" variant="ghost" onPress={() => navigation.navigate('Recorder', { scheduleId })} />
      )}

      {/* Can't make it */}
      {canAct && (
        <>
          <SectionTitle title="Can't make it?" />
          {myExcuse && <Card style={s.statusCard}><Text style={s.statusText}>Excuse filed</Text><StatusBadge status={myExcuse.status} /></Card>}
          {mySub && <Card style={s.statusCard}><Text style={s.statusText}>Substitute request</Text><StatusBadge status={mySub.status} label={mySub.status === 'Accepted' && mySub.substituteName ? `Covered by ${mySub.substituteName}` : mySub.status} /></Card>}
          {!myExcuse && !mySub && (
            <View style={s.actions}>
              <Button title="File an Excuse" icon="document-text-outline" variant="secondary" style={s.flex}
                onPress={() => navigation.navigate('RequestForm', { mode: 'excuse', date: lineup.date, scheduleId })} />
              <Button title="Ask for a Sub" icon="people-outline" variant="secondary" style={s.flex}
                onPress={() => navigation.navigate('RequestForm', { mode: 'sub', scheduleId })} />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function PersonRow({ person, part, me }: { person: Person; part: string; me: boolean }) {
  return (
    <View style={s.person}>
      <Avatar name={person.name} picture={person.picture} size={36} ring={me ? colors.gold : undefined} />
      <View style={s.flex}>
        <Text style={[s.personName, me && s.personMe]}>{person.name}{me ? ' (You)' : ''}</Text>
      </View>
      <Chip label={part} color={partColor(part)} />
    </View>
  );
}

function SongGroup({ title, icon, songs }: { title: string; icon: React.ComponentProps<typeof Ionicons>['name']; songs: Song[] }) {
  if (!songs.length) return null;
  return (
    <Card>
      <View style={s.groupHead}><Ionicons name={icon} size={16} color={colors.goldLight} /><Text style={s.groupTitle}>{title}</Text></View>
      {songs.map((song, i) => {
        const vid = youtubeId(song.link);
        return (
          <View key={`${song.title}-${i}`} style={[s.song, i > 0 && s.songDivider]}>
            <Text style={s.songNumber}>{i + 1}</Text>
            <View style={s.flex}>
              <Text style={s.songTitle}>{song.title}</Text>
              {song.instructions ? <Text style={s.muted}>{song.instructions}</Text> : null}
              {vid ? (
                <Pressable onPress={() => Linking.openURL(song.link)} style={s.thumbWrap} accessibilityRole="link" accessibilityLabel={`Play ${song.title} on YouTube`}>
                  <Image source={{ uri: youtubeThumb(vid) }} style={s.thumb} />
                  <View style={s.thumbPlay}><Ionicons name="logo-youtube" size={30} color="#ff0033" /></View>
                </Pressable>
              ) : song.link ? (
                <Pressable onPress={() => Linking.openURL(song.link)}><Text style={s.link}>Open link</Text></Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

// One player for the whole list: tapping another recording switches to it.
function RecordingList({ list, error, loading, myId, onDeleted }: {
  list: Recording[] | null; error: string | null; loading: boolean; myId: string; onDeleted: () => void;
}) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Plays through the speaker even with the iPhone's silent switch on.
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); }, []);

  const toggle = (rec: Recording) => {
    if (activeId === rec.id) {
      if (status.playing) player.pause();
      else {
        if (status.didJustFinish || (status.duration && status.currentTime >= status.duration - 0.2)) player.seekTo(0);
        player.play();
      }
      return;
    }
    player.replace({ uri: rec.google_drive_url });
    player.play();
    setActiveId(rec.id);
  };

  const remove = (rec: Recording) => {
    Alert.alert('Delete recording?', `"${rec.title}" will be removed for the whole team.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          if (activeId === rec.id) { player.pause(); setActiveId(null); }
          const res = await api.deleteRecording(rec.id);
          if (res.ok) onDeleted(); else Alert.alert('Could not delete', res.message);
        },
      },
    ]);
  };

  if (error && !list) return <Banner tone="danger" text={error} />;
  if (!list) return <Card><Text style={s.muted}>{loading ? 'Loading recordings…' : ''}</Text></Card>;
  if (!list.length) return <Card><Text style={s.muted}>No practice recordings yet.</Text></Card>;

  return (
    <Card>
      {list.map((rec, i) => {
        const active = activeId === rec.id;
        const playing = active && status.playing;
        return (
          <View key={rec.id} style={[s.rec, i > 0 && s.songDivider]}>
            <Pressable onPress={() => toggle(rec)} style={[s.playBtn, active && s.playBtnOn]} accessibilityRole="button" accessibilityLabel={playing ? `Pause ${rec.title}` : `Play ${rec.title}`}>
              <Ionicons name={playing ? 'pause' : 'play'} size={20} color={active ? colors.textOnGold : colors.goldLight} />
            </Pressable>
            <View style={s.flex}>
              <Text style={s.songTitle} numberOfLines={1}>{rec.title}</Text>
              <Text style={s.recMeta}>
                {rec.song_type} · {rec.recorded_by_name || 'Team'}
                {active && status.duration ? ` · ${formatClock(status.currentTime)} / ${formatClock(status.duration)}` : ''}
              </Text>
              {active && status.duration ? (
                <View style={s.progress}><View style={[s.progressFill, { width: `${Math.min(100, (status.currentTime / status.duration) * 100)}%` }]} /></View>
              ) : null}
            </View>
            {rec.recorded_by === myId && (
              <Pressable onPress={() => remove(rec)} hitSlop={10} accessibilityLabel={`Delete ${rec.title}`}>
                <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  when: { color: colors.goldLight, fontSize: font.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  date: { color: colors.text, fontSize: font.xxl, fontWeight: '900', marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.md },
  muted: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19 },
  subNote: { color: colors.textMuted, fontSize: font.xs, marginLeft: 48, marginTop: -6, marginBottom: 6 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 7 },
  personName: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  personMe: { color: colors.goldLight, fontWeight: '800' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  groupTitle: { color: colors.goldLight, fontSize: font.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  song: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  songDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  songNumber: { color: colors.textMuted, fontSize: font.lg, fontWeight: '900', width: 18 },
  songTitle: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  thumbWrap: { marginTop: space.sm, borderRadius: radius.md, overflow: 'hidden', width: 200, height: 112 },
  thumb: { width: '100%', height: '100%' },
  thumbPlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  link: { color: colors.info, fontSize: font.sm, fontWeight: '700', marginTop: 4 },
  rec: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  playBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  playBtnOn: { backgroundColor: colors.gold },
  recMeta: { color: colors.textSecondary, fontSize: font.xs, marginTop: 2 },
  progress: { height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.gold },
  actions: { flexDirection: 'row', gap: space.sm },
  statusCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusText: { color: colors.text, fontSize: font.md, fontWeight: '700' },
});
