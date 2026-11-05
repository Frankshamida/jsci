import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSession } from '../session';
import { useLineup } from '../lineups';
import { useRecordings, invalidateRecordings } from '../recordings';
import { api } from '../api';
import type { StackProps } from '../routes';
import { useDialog } from '../dialog';
import { Avatar, Banner, Button, Card, Chip, EmptyState, Icon, Screen, SectionTitle, StatusBadge, type IconName } from '../components';
import { font, fonts, makeStyles, partColor, radius, space, useTheme } from '../theme';
import { formatClock, longDate, relativeDay, shortDate, youtubeId, youtubeThumb } from '../utils';
import type { Person, Recording, Song } from '../types';

export default function LineupScreen({ route, navigation }: StackProps<'Lineup'>) {
  const { scheduleId } = route.params;
  const lineup = useLineup(scheduleId);
  const { home, profile, refresh } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const recordings = useRecordings(scheduleId);

  useEffect(() => { if (lineup) navigation.setOptions({ title: shortDate(lineup.date) }); }, [lineup, navigation]);

  if (!lineup || !home || !profile) {
    return <Screen stacked><EmptyState icon="circle-exclamation" title="Lineup not found" text="Pull down on Home to refresh, then try again." /></Screen>;
  }

  const past = lineup.date < home.today;
  const me = profile.fullName.toLowerCase();
  const isMe = (p: Person) => p.name.toLowerCase() === me;
  const myExcuse = home.excuses.find((e) => e.excuse_date === lineup.date && e.status !== 'Rejected');
  const mySub = home.substitutes.find((x) => x.date === lineup.date && x.requesterId === profile.id && x.status !== 'Rejected');
  const canAct = lineup.mine && !past && !lineup.subbedOut;
  const hasSongs = lineup.slowSongs.length + lineup.fastSongs.length > 0;

  return (
    <Screen stacked onRefresh={() => Promise.all([refresh(true), recordings.reload()])}>
      <Text style={s.when}>{relativeDay(lineup.date, home.today)}</Text>
      <Text style={s.date}>{longDate(lineup.date)}</Text>
      {lineup.myParts.length > 0 && (
        <View style={s.chips}>{lineup.myParts.map((p) => <Chip key={p} label={`You: ${p}`} color={partColor(c, p)} solid />)}</View>
      )}
      {lineup.subbedOut && <Banner tone="info" icon="people-arrows" text="A substitute is covering for you as Song Leader on this date." />}
      {lineup.practiceDate && (
        <Banner tone="info" icon="calendar-check" text={`Practice: ${longDate(lineup.practiceDate)}${lineup.practiceTime ? ` at ${lineup.practiceTime}` : ''}`} />
      )}

      {/* Who is on */}
      <SectionTitle title="Team" icon="users" />
      <Card>
        {lineup.songLeader && <PersonRow person={lineup.songLeader} part="Song Leader" icon="microphone" me={isMe(lineup.songLeader)} />}
        {lineup.originalSongLeader && <Text style={s.subNote}>Substituting for {lineup.originalSongLeader}</Text>}
        {lineup.backupSingers.map((p) => <PersonRow key={`b-${p.name}`} person={p} part="Backup Singer" icon="users" me={isMe(p)} />)}
        {lineup.musicians.map((p) => <PersonRow key={`m-${p.instrument}-${p.name}`} person={p} part={p.instrument} icon="guitar" me={isMe(p)} />)}
        {lineup.dancers.map((p) => <PersonRow key={`d-${p.name}`} person={p} part="Dancer" icon="person-running" me={isMe(p)} />)}
        {!lineup.songLeader && !lineup.backupSingers.length && !lineup.musicians.length && <Text style={s.muted}>Nobody plotted yet.</Text>}
      </Card>

      {/* Songs */}
      <SectionTitle
        title="Songs"
        icon="music"
        action={lineup.isSongLeader && !past ? (hasSongs ? 'Edit' : 'Add') : undefined}
        onAction={() => navigation.navigate('SongEditor', { scheduleId })}
      />
      {!hasSongs ? (
        <Card>
          <EmptyState
            icon="music"
            title={lineup.isSongLeader ? 'Add the songs for your team' : 'No songs yet'}
            text={lineup.isSongLeader ? 'Your team sees them here as soon as you save.' : 'The Song Leader has not added the songs yet.'}
          />
          {lineup.isSongLeader && !past && <Button title="Add Songs" icon="plus" onPress={() => navigation.navigate('SongEditor', { scheduleId })} />}
        </Card>
      ) : (
        <>
          <SongGroup title="Slow Songs" icon="leaf" songs={lineup.slowSongs} />
          <SongGroup title="Fast Songs" icon="bolt" songs={lineup.fastSongs} />
        </>
      )}

      {/* Practice recordings */}
      <SectionTitle title="Practice Recordings" icon="microphone-lines" />
      <RecordingList
        list={recordings.list}
        error={recordings.error}
        loading={recordings.loading}
        myId={profile.id}
        onDeleted={() => { invalidateRecordings(scheduleId); recordings.reload(); }}
      />
      {lineup.mine && !lineup.subbedOut && (
        <Button title="Record or Upload Practice" icon="microphone" variant="ghost" onPress={() => navigation.navigate('Recorder', { scheduleId })} />
      )}

      {/* Can't make it */}
      {canAct && (
        <>
          <SectionTitle title="Can't make it?" icon="calendar-minus" />
          {myExcuse && <Card style={s.statusCard}><Text style={s.statusText}>Excuse filed</Text><StatusBadge status={myExcuse.status} /></Card>}
          {mySub && <Card style={s.statusCard}><Text style={s.statusText}>Substitute request</Text><StatusBadge status={mySub.status} label={mySub.status === 'Accepted' && mySub.substituteName ? `Covered by ${mySub.substituteName}` : mySub.status} /></Card>}
          {!myExcuse && !mySub && (
            <View style={s.actions}>
              <Button title="File an Excuse" icon="calendar-minus" variant="secondary" style={s.flex}
                onPress={() => navigation.navigate('RequestForm', { mode: 'excuse', date: lineup.date, scheduleId })} />
              <Button title="Ask for a Sub" icon="people-arrows" variant="secondary" style={s.flex}
                onPress={() => navigation.navigate('RequestForm', { mode: 'sub', scheduleId })} />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function PersonRow({ person, part, icon, me }: { person: Person; part: string; icon: IconName; me: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.person}>
      <Avatar name={person.name} picture={person.picture} size={36} ring={me ? c.secondary : undefined} />
      <View style={s.flex}>
        <Text style={[s.personName, me && s.personMe]} numberOfLines={1}>{person.name}{me ? ' (You)' : ''}</Text>
      </View>
      <Chip label={part} icon={icon} color={partColor(c, part)} />
    </View>
  );
}

function SongGroup({ title, icon, songs }: { title: string; icon: IconName; songs: Song[] }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  if (!songs.length) return null;
  return (
    <Card>
      <View style={s.groupHead}><Icon name={icon} size={13} color={c.goldText} /><Text style={s.groupTitle}>{title}</Text></View>
      {songs.map((song, i) => {
        const vid = youtubeId(song.link);
        return (
          <View key={`${song.title}-${i}`} style={[s.song, i > 0 && s.divider]}>
            <Text style={s.songNumber}>{i + 1}</Text>
            <View style={s.flex}>
              <Text style={s.songTitle}>{song.title}</Text>
              {song.instructions ? <Text style={s.muted}>{song.instructions}</Text> : null}
              {vid ? (
                <Pressable onPress={() => Linking.openURL(song.link)} style={s.thumbWrap} accessibilityRole="link" accessibilityLabel={`Play ${song.title} on YouTube`}>
                  <Image source={{ uri: youtubeThumb(vid) }} style={s.thumb} />
                  <View style={s.thumbPlay}><Icon name="youtube" size={30} color="#ff0033" /></View>
                </Pressable>
              ) : song.link ? (
                <Pressable onPress={() => Linking.openURL(song.link)} style={s.linkRow}>
                  <Icon name="arrow-up-right-from-square" size={11} color={c.info} />
                  <Text style={s.link}>Open link</Text>
                </Pressable>
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
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
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

  const remove = async (rec: Recording) => {
    const ok = await dialog.confirm({
      icon: 'trash-can', tone: 'danger', title: 'Delete recording?',
      message: `"${rec.title}" will be removed for the whole team.`, confirmText: 'Delete',
    });
    if (!ok) return;
    if (activeId === rec.id) { player.pause(); setActiveId(null); }
    const res = await api.deleteRecording(rec.id);
    if (res.ok) onDeleted();
    else dialog.alert({ icon: 'circle-exclamation', tone: 'danger', title: 'Could not delete', message: res.message });
  };

  if (error && !list) return <Banner tone="danger" text={error} />;
  if (!list) return <Card><Text style={s.muted}>{loading ? 'Loading recordings…' : ''}</Text></Card>;
  if (!list.length) return <Card><EmptyState icon="headphones" title="No practice recordings yet" /></Card>;

  return (
    <Card>
      {list.map((rec, i) => {
        const active = activeId === rec.id;
        const playing = active && status.playing;
        return (
          <View key={rec.id} style={[s.rec, i > 0 && s.divider]}>
            <Pressable onPress={() => toggle(rec)} style={[s.playBtn, active && s.playBtnOn]} accessibilityRole="button" accessibilityLabel={playing ? `Pause ${rec.title}` : `Play ${rec.title}`}>
              <Icon name={playing ? 'pause' : 'play'} size={15} color={active ? c.onGold : c.goldText} />
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
              <Pressable onPress={() => remove(rec)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${rec.title}`}>
                <Icon name="trash-can" size={15} color={c.textMuted} />
              </Pressable>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  when: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1.2 },
  date: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold, marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.md },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  subNote: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, marginLeft: 48, marginTop: -6, marginBottom: 6 },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 7 },
  personName: { color: c.text, fontSize: font.md, fontFamily: fonts.medium },
  personMe: { color: c.goldText, fontFamily: fonts.bold },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  groupTitle: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1 },
  song: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  songNumber: { color: c.textMuted, fontSize: font.lg, fontFamily: fonts.bold, width: 18 },
  songTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  thumbWrap: { marginTop: space.sm, borderRadius: radius.md, overflow: 'hidden', width: 200, height: 112 },
  thumb: { width: '100%', height: '100%' },
  thumbPlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  link: { color: c.info, fontSize: font.sm, fontFamily: fonts.semibold },
  rec: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  playBtn: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: c.secondary, alignItems: 'center', justifyContent: 'center' },
  playBtnOn: { backgroundColor: c.secondary },
  recMeta: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.regular, marginTop: 2 },
  progress: { height: 4, borderRadius: 2, backgroundColor: c.border, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: c.secondary },
  actions: { flexDirection: 'row', gap: space.sm },
  statusCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusText: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
}));
