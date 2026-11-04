import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../session';
import { useLineup } from '../lineups';
import { api } from '../api';
import type { StackProps } from '../routes';
import { Banner, Button, Card, ChoiceRow, EmptyState, Field, Screen } from '../components';
import { colors, font, radius, space } from '../theme';
import { longDate, youtubeId, youtubeThumb } from '../utils';
import type { Song } from '../types';

// The server keeps 10 songs per list; same limits as the website.
const MAX_SONGS = 10;
type ListKey = 'slow' | 'fast';
const LISTS: ListKey[] = ['slow', 'fast'];
const LIST_LABEL: Record<ListKey, string> = { slow: 'Slow Songs', fast: 'Fast Songs' };

const blank = (): Song => ({ title: '', link: '', instructions: '' });
const linkError = (link: string) => (link.trim() && !/^https?:\/\//i.test(link.trim()) ? 'Paste the full link, starting with https://' : null);

export default function SongEditorScreen({ route, navigation }: StackProps<'SongEditor'>) {
  const { scheduleId } = route.params;
  const lineup = useLineup(scheduleId);
  const { refresh } = useSession();

  const [lists, setLists] = useState<Record<ListKey, Song[]>>(() => ({
    slow: lineup?.slowSongs.length ? lineup.slowSongs.map((x) => ({ ...x })) : [blank()],
    fast: lineup?.fastSongs.length ? lineup.fastSongs.map((x) => ({ ...x })) : [blank()],
  }));
  const [tab, setTab] = useState<ListKey>('slow');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const leaving = useRef(false);

  // Leaving with unsaved songs asks first.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirty.current || leaving.current) return;
    e.preventDefault();
    Alert.alert('Discard changes?', 'Your song changes are not saved yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
    ]);
  }), [navigation]);

  if (!lineup) return <Screen stacked><EmptyState icon="alert-circle-outline" title="Lineup not found" /></Screen>;
  if (!lineup.isSongLeader) {
    return <Screen stacked><EmptyState icon="lock-closed-outline" title="Song Leader only" text="Only the Song Leader of this lineup can set its songs." /></Screen>;
  }

  const edit = (list: ListKey, update: (songs: Song[]) => Song[]) => {
    dirty.current = true;
    setError(null);
    setLists((prev) => ({ ...prev, [list]: update(prev[list]) }));
  };
  const setField = (i: number, key: keyof Song, value: string) => edit(tab, (songs) => songs.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
  const remove = (i: number) => edit(tab, (songs) => songs.filter((_, j) => j !== i));
  const move = (i: number, by: -1 | 1) => edit(tab, (songs) => {
    const next = [...songs];
    const [song] = next.splice(i, 1);
    next.splice(i + by, 0, song);
    return next;
  });

  const save = async () => {
    const clean = (songs: Song[]) => songs
      .map((x) => ({ title: x.title.trim(), link: x.link.trim(), instructions: x.instructions.trim() }))
      .filter((x) => x.title || x.link || x.instructions);
    const slow = clean(lists.slow);
    const fast = clean(lists.fast);
    const all = [...slow, ...fast];
    if (!all.length) return setError('Add at least one song.');
    if (all.some((x) => !x.title)) return setError('Every song needs a title.');
    if (all.some((x) => linkError(x.link))) return setError('One of the links is not a full link. Paste it starting with https://');

    setSaving(true);
    const res = await api.saveSongs(scheduleId, slow, fast);
    if (!res.ok) { setSaving(false); return setError(res.message); }
    await refresh(true);
    setSaving(false);
    leaving.current = true;
    navigation.goBack();
  };

  const songs = lists[tab];
  const counts = { slow: lists.slow.filter((x) => x.title.trim()).length, fast: lists.fast.filter((x) => x.title.trim()).length };

  return (
    <Screen stacked>
      <Text style={s.date}>{longDate(lineup.date)}</Text>
      <Text style={s.help}>Your team sees these songs as soon as you save. Paste a YouTube link so they can practice.</Text>

      <ChoiceRow options={LISTS} value={tab} onChange={setTab} labels={{ slow: `Slow Songs (${counts.slow})`, fast: `Fast Songs (${counts.fast})` }} />

      {songs.map((song, i) => {
        const vid = youtubeId(song.link);
        return (
          <Card key={`${tab}-${i}`}>
            <View style={s.songHead}>
              <Text style={s.songNumber}>{LIST_LABEL[tab].replace('Songs', 'Song')} {i + 1}</Text>
              <View style={s.tools}>
                <IconBtn icon="arrow-up" label="Move up" disabled={i === 0} onPress={() => move(i, -1)} />
                <IconBtn icon="arrow-down" label="Move down" disabled={i === songs.length - 1} onPress={() => move(i, 1)} />
                <IconBtn icon="trash-outline" label="Remove song" onPress={() => remove(i)} danger />
              </View>
            </View>
            <Field label="Title" value={song.title} onChangeText={(v) => setField(i, 'title', v)} placeholder="e.g. Way Maker" maxLength={120} autoCapitalize="words" />
            <Field
              label="YouTube link"
              value={song.link}
              onChangeText={(v) => setField(i, 'link', v)}
              placeholder="Paste the link here"
              maxLength={300}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint={linkError(song.link) || undefined}
            />
            {vid && (
              <View style={s.preview}>
                <Image source={{ uri: youtubeThumb(vid) }} style={s.thumb} />
                <Text style={s.previewText}>YouTube video found</Text>
              </View>
            )}
            <Field label="Notes for the team (optional)" value={song.instructions} onChangeText={(v) => setField(i, 'instructions', v)} placeholder="Key, intro, who sings the bridge…" maxLength={300} multiline />
          </Card>
        );
      })}

      {songs.length < MAX_SONGS ? (
        <Button title={`Add a ${tab === 'slow' ? 'slow' : 'fast'} song`} icon="add" variant="ghost" onPress={() => edit(tab, (list) => [...list, blank()])} />
      ) : (
        <Text style={s.help}>That is the most songs for one list ({MAX_SONGS}).</Text>
      )}

      <View style={s.saveArea}>
        {error && <Banner tone="danger" text={error} />}
        <Button title="Save Songs" icon="checkmark" onPress={save} loading={saving} />
      </View>
    </Screen>
  );
}

function IconBtn({ icon, label, onPress, disabled, danger }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={[s.iconBtn, disabled && s.iconOff]}>
      <Ionicons name={icon} size={17} color={danger ? colors.danger : colors.textSecondary} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  date: { color: colors.text, fontSize: font.xl, fontWeight: '900' },
  help: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, marginVertical: space.sm },
  songHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  songNumber: { color: colors.goldLight, fontSize: font.sm, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 },
  tools: { flexDirection: 'row', gap: 4 },
  iconBtn: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  iconOff: { opacity: 0.3 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: -4, marginBottom: space.md },
  thumb: { width: 96, height: 54, borderRadius: radius.sm, backgroundColor: colors.surface },
  previewText: { color: colors.success, fontSize: font.sm, fontWeight: '700' },
  saveArea: { marginTop: space.lg },
});
