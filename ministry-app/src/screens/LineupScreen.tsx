import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSession } from '../session';
import { useLineup } from '../lineups';
import { useMonth } from '../months';
import { useRecordings, invalidateRecordings } from '../recordings';
import { useLineupLyrics } from '../lyrics';
import { usePlayer, type Track } from '../player';
import { api } from '../api';
import { useAppNav, type StackProps } from '../routes';
import { useDialog } from '../dialog';
import {
  Avatar, Banner, Button, Card, Chip, EmptyState, Icon, LoadingView, Screen, SectionTitle, Segmented, StatusBadge, type IconName,
} from '../components';
import { font, fonts, makeStyles, partColor, radius, space, useTheme } from '../theme';
import { formatClock, longDate, monthDay, relativeDay, shortDate, youtubeId } from '../utils';
import type { CoveredPerson, Lineup, Person, Recording, Song } from '../types';

type Tab = 'lead' | 'backup' | 'band' | 'dance';
type SongView = 'songs' | 'lyrics';

// Which tab a substitute's original person belongs on.
const TAB_OF_ROLE: Record<string, Tab> = { 'Song Leader': 'lead', 'Backup Singer': 'backup', Instrumentalist: 'band', Dancer: 'dance' };

export default function LineupScreen({ route, navigation }: StackProps<'Lineup'>) {
  const { scheduleId, date } = route.params;
  const { home, profile, refresh } = useSession();
  // From a teammate's history the lineup may be in a month not seen yet.
  const cached = useLineup(scheduleId);
  const month = useMonth(cached || !date ? (home?.today || '').slice(0, 7) : date.slice(0, 7));
  const lineup = cached || month.data?.lineups.find((l) => l.scheduleId === scheduleId) || null;
  const { colors: c } = useTheme();
  const s = useStyles();
  const recordings = useRecordings(scheduleId);
  const [tab, setTab] = useState<Tab>('lead');

  useEffect(() => { if (lineup) navigation.setOptions({ title: shortDate(lineup.date) }); }, [lineup, navigation]);

  if (!lineup || !home || !profile) {
    if (month.loading) return <LoadingView message="Loading the lineup…" />;
    return <Screen stacked><EmptyState icon="circle-exclamation" title="Lineup not found" text="It may have been removed. Pull down on Home to refresh." /></Screen>;
  }

  const past = lineup.date < home.today;
  const me = profile.fullName.toLowerCase();
  const isMe = (p: Person) => p.name.toLowerCase() === me;
  const myExcuse = home.excuses.find((e) => e.excuse_date === lineup.date && e.status !== 'Rejected');
  const mySub = home.substitutes.find((x) => x.date === lineup.date && x.requesterId === profile.id && x.status !== 'Rejected');
  const mySwap = (home.swaps || []).find((w) => ['Waiting Partner', 'Pending Approval'].includes(w.status)
    && ((w.requesterId === profile.id && w.requesterDate === lineup.date) || (w.partnerId === profile.id && w.partnerDate === lineup.date)));
  const canAct = lineup.mine && !past && !lineup.subbedOut;
  const covered = (t: Tab) => (lineup.covered || []).filter((x) => TAB_OF_ROLE[x.roleType] === t);

  return (
    <Screen stacked onRefresh={() => Promise.all([refresh(true), recordings.reload()])}>
      <View style={s.head}>
        <View style={s.flex}>
          <Text style={[s.when, past && { color: c.textMuted }]}>{past ? 'Past lineup' : relativeDay(lineup.date, home.today)}</Text>
          <Text style={s.date}>{longDate(lineup.date)}</Text>
        </View>
        {profile.canPlot && (
          <Pressable onPress={() => navigation.navigate('LineupEditor', { scheduleId })} style={s.editBtn} accessibilityRole="button" accessibilityLabel="Edit this lineup">
            <Icon name="pen-to-square" size={14} color={c.goldText} />
            <Text style={s.editText}>Edit</Text>
          </Pressable>
        )}
      </View>
      <View style={s.chips}>
        {lineup.myParts.map((p) => <Chip key={p} label={`You: ${p}`} color={partColor(c, p)} solid />)}
        {!lineup.mine && <Chip label="You: REST" icon="mug-hot" color={c.textSecondary} />}
      </View>
      {lineup.subbedOut && <Banner tone="info" icon="people-arrows" text="A substitute is covering for you as Song Leader on this date." />}
      {lineup.practiceDate && (
        <Banner tone="info" icon="calendar-check" text={`Practice: ${longDate(lineup.practiceDate)}${lineup.practiceTime ? ` at ${lineup.practiceTime}` : ''}`} />
      )}

      <Segmented<Tab>
        options={['lead', 'backup', 'band', 'dance']}
        value={tab}
        onChange={setTab}
        labels={{ lead: 'Song Lead', backup: 'Backup', band: 'Musicians', dance: 'Dancers' }}
      />

      {tab === 'lead' && <SongLeadTab lineup={lineup} isMe={isMe} past={past} covered={covered('lead')} canEditLyrics={profile.canEditLyrics} />}
      {tab === 'backup' && (
        <PeopleCard people={lineup.backupSingers.map((p) => ({ p, part: 'Backup Singer', icon: 'users' as IconName }))} covered={covered('backup')} isMe={isMe}
          empty="No backup singers on this lineup." />
      )}
      {tab === 'band' && (
        <PeopleCard people={lineup.musicians.map((p) => ({ p, part: p.instrument, icon: instrumentIcon(p.instrument) }))} covered={covered('band')} isMe={isMe}
          empty="No musicians on this lineup." />
      )}
      {tab === 'dance' && (
        <PeopleCard people={lineup.dancers.map((p) => ({ p, part: 'Dancer', icon: 'person-running' as IconName }))} covered={covered('dance')} isMe={isMe}
          empty="No dancers on this lineup." />
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
          {myExcuse && <StatusCard label="Excuse" status={myExcuse.status} text={myExcuse.status === 'Pending' ? 'Waiting for the Schedule Plotter' : myExcuse.status} />}
          {mySub && (
            <StatusCard label="Substitute" status={mySub.status}
              text={mySub.status === 'Accepted' && mySub.substituteName ? `Covered by ${mySub.substituteName}` : mySub.status === 'Pending Admin' ? 'Waiting for approval' : mySub.status === 'Open for Sub' ? 'Open to teammates' : mySub.status} />
          )}
          {mySwap && (
            <StatusCard label="Swap" status={mySwap.status === 'Waiting Partner' ? 'Pending' : 'Pending Admin'}
              text={`With ${mySwap.requesterId === profile.id ? mySwap.partnerName : mySwap.requesterName}: ${mySwap.status === 'Waiting Partner' ? 'waiting for their answer' : 'waiting for approval'}`} />
          )}
          {!myExcuse && !mySub && !mySwap && (
            <View style={s.actionGrid}>
              <ActionTile icon="calendar-minus" title="File an Excuse" onPress={() => navigation.navigate('RequestForm', { mode: 'excuse', date: lineup.date, scheduleId })} />
              <ActionTile icon="people-arrows" title="Ask for a Sub" onPress={() => navigation.navigate('RequestForm', { mode: 'sub', scheduleId })} />
              <ActionTile icon="right-left" title="Swap Schedule" onPress={() => navigation.navigate('RequestForm', { mode: 'swap', scheduleId })} />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const instrumentIcon = (instrument: string): IconName => (instrument === 'Keyboard' ? 'keyboard' : instrument === 'Drums' ? 'drum' : 'guitar');

function ActionTile({ icon, title, onPress }: { icon: IconName; title: string; onPress: () => void }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={title}>
      <View style={s.tileIcon}><Icon name={icon} size={16} color={c.goldText} /></View>
      <Text style={s.tileText}>{title}</Text>
    </Pressable>
  );
}

function StatusCard({ label, status, text }: { label: string; status: string; text: string }) {
  const s = useStyles();
  return (
    <Card style={s.statusCard}>
      <View style={s.flex}>
        <Text style={s.statusLabel}>{label}</Text>
        <Text style={s.statusText}>{text}</Text>
      </View>
      <StatusBadge status={status} label={status === 'Pending Admin' ? 'Pending' : undefined} />
    </Card>
  );
}

// ---- People ----

// One person on the lineup, with what is happening to them that day.
function PersonRow({ person, part, icon, me, lead }: { person: Person; part: string; icon: IconName; me: boolean; lead?: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const excused = person.excuse === 'Approved';
  const notes: { text: string; color: string; icon: IconName }[] = [];
  if (person.excuse === 'Approved') notes.push({ text: 'Excused', color: c.danger, icon: 'calendar-xmark' });
  if (person.excuse === 'Pending') notes.push({ text: 'Excuse pending', color: c.warning, icon: 'hourglass-half' });
  if (person.subRequest === 'Pending Admin') notes.push({ text: 'Asked for a sub (waiting for approval)', color: c.warning, icon: 'hourglass-half' });
  if (person.subRequest === 'Open for Sub') notes.push({ text: 'Needs a sub', color: c.info, icon: 'people-arrows' });
  if (person.covering) notes.push({ text: `Covering for ${person.covering}`, color: c.info, icon: 'user-check' });
  if (person.swap) notes.push({ text: 'Swap pending', color: c.band, icon: 'right-left' });
  return (
    <View style={[s.person, excused && s.dimmed]}>
      <Avatar name={person.name} picture={person.picture} size={lead ? 48 : 38} ring={me ? c.secondary : undefined} />
      <View style={s.flex}>
        <Text style={[s.personName, lead && s.leadName, me && !lead && s.personMe, excused && s.struckName]} numberOfLines={1}>
          {person.name}{me ? ' (You)' : ''}
        </Text>
        {notes.map((n) => (
          <View key={n.text} style={s.noteRow}><Icon name={n.icon} size={10} color={n.color} /><Text style={[s.noteText, { color: n.color }]}>{n.text}</Text></View>
        ))}
      </View>
      <Chip label={part} icon={icon} color={partColor(c, part)} />
    </View>
  );
}

// Somebody a substitute took over from: greyed out, with who covers them.
function CoveredRow({ person }: { person: CoveredPerson }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  return (
    <View style={[s.person, s.dimmed]}>
      <Avatar name={person.name} picture={person.picture} size={34} />
      <View style={s.flex}>
        <Text style={[s.personName, s.struckName]} numberOfLines={1}>{person.name}</Text>
        <View style={s.noteRow}><Icon name="people-arrows" size={10} color={c.info} /><Text style={[s.noteText, { color: c.info }]}>Covered by {person.by}</Text></View>
      </View>
    </View>
  );
}

function PeopleCard({ people, covered, isMe, empty }: {
  people: { p: Person; part: string; icon: IconName }[]; covered: CoveredPerson[]; isMe: (p: Person) => boolean; empty: string;
}) {
  const s = useStyles();
  if (!people.length && !covered.length) return <Card><EmptyState icon="users" title={empty} /></Card>;
  return (
    <Card>
      {people.map(({ p, part, icon }, i) => <View key={`${part}-${p.name}`} style={i > 0 && s.divider}><PersonRow person={p} part={part} icon={icon} me={isMe(p)} /></View>)}
      {covered.map((x) => <View key={`cov-${x.name}`} style={s.divider}><CoveredRow person={x} /></View>)}
    </Card>
  );
}

// ---- Song Lead: the leader, their songs, and the lyrics ----

function SongLeadTab({ lineup, isMe, past, covered, canEditLyrics }: {
  lineup: Lineup; isMe: (p: Person) => boolean; past: boolean; covered: CoveredPerson[]; canEditLyrics: boolean;
}) {
  const s = useStyles();
  const nav = useAppNav();
  const [view, setView] = useState<SongView>('songs');
  const hasSongs = lineup.slowSongs.length + lineup.fastSongs.length > 0;

  return (
    <>
      <Card>
        {lineup.songLeader
          ? <PersonRow person={lineup.songLeader} part="Song Leader" icon="microphone" me={isMe(lineup.songLeader)} lead />
          : <Text style={s.muted}>No Song Leader plotted yet.</Text>}
        {covered.map((x) => <View key={`cov-${x.name}`} style={s.divider}><CoveredRow person={x} /></View>)}
      </Card>

      {!hasSongs ? (
        <Card>
          <EmptyState
            icon="music"
            title={lineup.isSongLeader ? 'Add the songs for your team' : 'No songs yet'}
            text={lineup.isSongLeader ? 'Your team sees them here as soon as you save.' : 'The Song Leader has not added the songs yet.'}
          />
          {lineup.isSongLeader && !past && <Button title="Add Songs" icon="plus" onPress={() => nav.navigate('SongEditor', { scheduleId: lineup.scheduleId })} />}
        </Card>
      ) : (
        <>
          <View style={s.songBar}>
            <View style={s.flex}>
              <Segmented<SongView> options={['songs', 'lyrics']} value={view} onChange={setView} labels={{ songs: 'Songs', lyrics: 'Lyrics' }} icons={{ songs: 'music', lyrics: 'align-left' }} />
            </View>
            {lineup.isSongLeader && !past && (
              <Pressable onPress={() => nav.navigate('SongEditor', { scheduleId: lineup.scheduleId })} style={s.songEdit} hitSlop={6} accessibilityRole="button" accessibilityLabel="Edit songs">
                <Icon name="pen" size={13} color="#ffffff" />
              </Pressable>
            )}
          </View>
          {view === 'songs' ? <SongList lineup={lineup} /> : <LyricsView lineup={lineup} canEdit={canEditLyrics} />}
        </>
      )}
    </>
  );
}

// The lineup's songs as the player plays them: fast songs, then slow songs.
function lineupTracks(lineup: Lineup): { song: Song; type: 'Fast Song' | 'Slow Song'; number: number; track: Track | null }[] {
  const rows = [
    ...lineup.fastSongs.map((song, i) => ({ song, type: 'Fast Song' as const, number: i + 1 })),
    ...lineup.slowSongs.map((song, i) => ({ song, type: 'Slow Song' as const, number: i + 1 })),
  ];
  return rows.map((r) => {
    const videoId = youtubeId(r.song.link);
    return {
      ...r,
      track: videoId ? { key: `${lineup.scheduleId}:${r.type}:${r.number}`, videoId, title: r.song.title, subtitle: `${r.type} ${r.number} · ${monthDay(lineup.date)}`, link: r.song.link } : null,
    };
  });
}

function SongList({ lineup }: { lineup: Lineup }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const rows = useMemo(() => lineupTracks(lineup), [lineup]);
  const queue = useMemo(() => rows.map((r) => r.track).filter((t): t is Track => !!t), [rows]);
  const groups: { title: string; icon: IconName; type: 'Fast Song' | 'Slow Song' }[] = [
    { title: 'Fast Songs', icon: 'bolt', type: 'Fast Song' },
    { title: 'Slow Songs', icon: 'leaf', type: 'Slow Song' },
  ];
  return (
    <>
      {groups.map((g) => {
        const list = rows.filter((r) => r.type === g.type);
        if (!list.length) return null;
        return (
          <Card key={g.type}>
            <View style={s.groupHead}><Icon name={g.icon} size={12} color={c.goldText} /><Text style={s.groupTitle}>{g.title}</Text></View>
            {list.map((r, i) => <SongRow key={`${g.type}-${i}`} number={r.number} song={r.song} track={r.track} queue={queue} first={i === 0} />)}
          </Card>
        );
      })}
    </>
  );
}

function SongRow({ number, song, track, queue, first }: { number: number; song: Song; track: Track | null; queue: Track[]; first: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const player = usePlayer();
  const isCurrent = !!track && player.current?.key === track.key;
  const playing = isCurrent && (player.state === 'playing' || player.state === 'loading');
  const onPlay = () => {
    if (track) player.play(queue, queue.findIndex((t) => t.key === track.key));
    else if (song.link) Linking.openURL(song.link);
  };
  return (
    <View style={[s.song, !first && s.divider]}>
      <Text style={s.songNumber}>{number}.</Text>
      <Pressable onPress={onPlay} disabled={!song.link} hitSlop={6}
        style={({ pressed }) => [s.playBtn, isCurrent && s.playBtnOn, !song.link && s.playBtnOff, pressed && s.pressed]}
        accessibilityRole="button" accessibilityLabel={!song.link ? `${song.title}, no link` : playing ? `Pause ${song.title}` : `Play ${song.title}`}>
        <Icon name={!song.link ? 'music' : !track ? 'arrow-up-right-from-square' : playing ? 'pause' : 'play'} size={track ? 14 : 12}
          color={isCurrent ? '#ffffff' : song.link ? c.goldText : c.textMuted} style={track && !playing ? s.playNudge : undefined} />
      </Pressable>
      <Pressable onPress={onPlay} disabled={!song.link} style={s.flex} accessibilityRole="button" accessibilityLabel={`Play ${song.title}`}>
        <Text style={[s.songTitle, isCurrent && { color: c.goldText }]}>{song.title}</Text>
        {isCurrent && <Text style={s.nowPlaying}>{player.state === 'loading' ? 'Loading…' : player.state === 'error' ? 'Cannot play here' : playing ? 'Now playing' : 'Paused'}</Text>}
        {song.instructions ? <Text style={s.instructions}>{song.instructions}</Text> : null}
      </Pressable>
      {song.link ? (
        <Pressable onPress={() => Linking.openURL(song.link)} hitSlop={10} accessibilityRole="link" accessibilityLabel={`Open ${song.title} in YouTube`}>
          <Icon name={track ? 'youtube' : 'link'} size={16} color={track ? '#ff0033' : c.info} />
        </Pressable>
      ) : null}
    </View>
  );
}

// The words, one song at a time. While a song of this lineup plays, its
// lyrics come up by themselves (and the song keeps playing below).
function LyricsView({ lineup, canEdit }: { lineup: Lineup; canEdit: boolean }) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const nav = useAppNav();
  const player = usePlayer();
  const { data, loading, error, reload } = useLineupLyrics(lineup.scheduleId, true);
  const rows = useMemo(() => lineupTracks(lineup), [lineup]);
  const queue = useMemo(() => rows.map((r) => r.track).filter((t): t is Track => !!t), [rows]);
  const [picked, setPicked] = useState(0);
  const playingIndex = rows.findIndex((r) => r.track && r.track.key === player.current?.key);

  useEffect(() => { if (playingIndex >= 0) setPicked(playingIndex); }, [playingIndex]);

  if (!data) {
    if (error) return <Card><Banner tone="danger" text={error} /><Button title="Try again" icon="rotate-right" variant="secondary" onPress={reload} /></Card>;
    return <Card><Text style={s.muted}>{loading ? 'Loading the lyrics…' : ''}</Text></Card>;
  }

  const index = Math.min(picked, rows.length - 1);
  const row = rows[index];
  // The server lists songs in the same order: fast, then slow.
  const lyrics = data.songs[index]?.lyrics || null;
  const isCurrent = !!row.track && player.current?.key === row.track.key;
  const playing = isCurrent && (player.state === 'playing' || player.state === 'loading');

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.songPicker} style={s.songPickerWrap}>
        {rows.map((r, i) => {
          const on = i === index;
          const hasWords = !!data.songs[i]?.lyrics;
          return (
            <Pressable key={`${r.type}-${r.number}`} onPress={() => setPicked(i)} style={[s.pick, on && s.pickOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              {r.track && player.current?.key === r.track.key && <Icon name="volume-high" size={10} color={on ? c.goldText : c.textSecondary} />}
              <Text style={[s.pickText, on && s.pickTextOn, !hasWords && s.pickTextNone]} numberOfLines={1}>{r.type === 'Fast Song' ? 'F' : 'S'}{r.number} · {r.song.title}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Card>
        <View style={s.lyricsHead}>
          <View style={s.flex}>
            <Text style={s.lyricsKicker}>{row.type} {row.number}</Text>
            <Text style={s.lyricsTitle}>{row.song.title}</Text>
            {lyrics?.artist ? <Text style={s.muted}>{lyrics.artist}</Text> : null}
          </View>
          {row.track && (
            <Pressable onPress={() => player.play(queue, queue.findIndex((t) => t.key === row.track!.key))} style={[s.playBtn, isCurrent && s.playBtnOn]}
              accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play this song'}>
              <Icon name={playing ? 'pause' : 'play'} size={14} color={isCurrent ? '#ffffff' : c.goldText} style={!playing ? s.playNudge : undefined} />
            </Pressable>
          )}
        </View>

        {lyrics ? (
          <View style={s.lyricsBody}>
            {lyrics.sections.map((sec, i) => (
              <View key={`${sec.label}-${i}`} style={s.section}>
                {sec.label ? <Text style={s.sectionLabel}>{sec.label}</Text> : null}
                <Text style={s.lyricsText} selectable>{sec.content}</Text>
              </View>
            ))}
            {lyrics.preparedBy && <Text style={s.preparedBy}>Lyrics by {lyrics.preparedBy} · Media Team</Text>}
          </View>
        ) : (
          <EmptyState icon="align-left" title="No lyrics yet" text={canEdit ? 'Add them so the team can sing along.' : 'The Media team adds the lyrics for each lineup.'} />
        )}

        {canEdit && (
          <Button compact variant="ghost" icon={lyrics ? 'pen-to-square' : 'plus'} title={lyrics ? 'Edit lyrics' : 'Add lyrics'} style={s.lyricsEdit}
            onPress={() => nav.navigate('LyricsEditor', { title: row.song.title, link: row.song.link || undefined, lyricsId: lyrics?.id, scheduleId: lineup.scheduleId })} />
        )}
      </Card>
    </>
  );
}

// ---- Practice recordings ----

// One player for the whole list: tapping another recording switches to it.
function RecordingList({ list, error, loading, myId, onDeleted }: {
  list: Recording[] | null; error: string | null; loading: boolean; myId: string; onDeleted: () => void;
}) {
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const songs = usePlayer();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Plays through the speaker even with the iPhone's silent switch on.
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); }, []);

  const toggle = (rec: Recording) => {
    songs.pause(); // one sound at a time: the song player waits
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
              <Icon name={playing ? 'pause' : 'play'} size={14} color={active ? '#ffffff' : c.goldText} style={!playing ? s.playNudge : undefined} />
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
  pressed: { opacity: 0.8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  when: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1.2 },
  date: { color: c.text, fontSize: font.xxl, fontFamily: fonts.bold },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: c.goldMuted },
  editText: { color: c.goldText, fontSize: font.sm, fontFamily: fonts.bold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm, marginBottom: space.md },
  muted: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  divider: { borderTopWidth: 1, borderTopColor: c.border },
  dimmed: { opacity: 0.5 },

  person: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 9 },
  personName: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  leadName: { color: c.goldText, fontSize: font.lg, fontFamily: fonts.heavy },
  personMe: { color: c.goldText, fontFamily: fonts.bold },
  struckName: { textDecorationLine: 'line-through' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  noteText: { fontSize: font.xs, fontFamily: fonts.semibold },

  songBar: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  songEdit: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.secondary, alignItems: 'center', justifyContent: 'center' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  groupTitle: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.heavy, textTransform: 'uppercase', letterSpacing: 1.2 },
  song: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 10 },
  songNumber: { color: c.textMuted, fontSize: font.md, fontFamily: fonts.bold, width: 20 },
  songTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold },
  nowPlaying: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.semibold, marginTop: 1 },
  instructions: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.regular, marginTop: 2 },
  playBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: c.secondary, alignItems: 'center', justifyContent: 'center', backgroundColor: c.goldMuted },
  playBtnOn: { backgroundColor: c.secondary },
  playBtnOff: { borderColor: c.border, backgroundColor: 'transparent' },
  playNudge: { marginLeft: 2 },

  songPickerWrap: { marginBottom: space.sm, marginHorizontal: -space.lg },
  songPicker: { paddingHorizontal: space.lg, gap: space.sm },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, maxWidth: 220 },
  pickOn: { borderColor: c.secondary, backgroundColor: c.goldMuted },
  pickText: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.medium },
  pickTextOn: { color: c.goldText, fontFamily: fonts.bold },
  pickTextNone: { fontStyle: 'italic' },
  lyricsHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: c.border },
  lyricsKicker: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.heavy, textTransform: 'uppercase', letterSpacing: 1.2 },
  lyricsTitle: { color: c.text, fontSize: font.xl, fontFamily: fonts.bold },
  lyricsBody: { paddingTop: space.md },
  section: { marginBottom: space.lg },
  sectionLabel: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.heavy, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 4 },
  lyricsText: { color: c.text, fontSize: 17, lineHeight: 27, fontFamily: fonts.regular },
  preparedBy: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center' },
  lyricsEdit: { marginTop: space.sm },

  rec: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  recMeta: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.regular, marginTop: 2 },
  progress: { height: 4, borderRadius: 2, backgroundColor: c.border, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: c.secondary },

  actionGrid: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: space.md, paddingHorizontal: 4, borderRadius: radius.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.scheme === 'light' ? '#eceef1' : c.border },
  tileIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.goldMuted, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: c.text, fontSize: font.sm, fontFamily: fonts.semibold, textAlign: 'center' },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statusLabel: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 1 },
  statusText: { color: c.text, fontSize: font.md, fontFamily: fonts.semibold, marginTop: 2 },
}));
