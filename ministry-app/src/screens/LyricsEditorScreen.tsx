import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../api';
import type { StackProps } from '../routes';
import { useSession } from '../session';
import { useDialog } from '../dialog';
import { cachedLyrics, invalidateLyrics } from '../lyrics';
import { findLineup } from '../lineups';
import { Banner, Button, Card, EmptyState, Field, Icon, Screen } from '../components';
import { font, fonts, makeStyles, radius, space, useTheme } from '../theme';
import type { LyricsSection } from '../types';

const PARTS = ['Verse 1', 'Verse 2', 'Pre-Chorus', 'Chorus', 'Bridge', 'Tag', 'Outro'];

// Sections back to the text the Media team types: "[Chorus]" lines between parts.
const toText = (sections: LyricsSection[]) => sections.map((s) => `${s.label ? `[${s.label}]\n` : ''}${s.content}`).join('\n\n');

// The Media team writes a song's lyrics, for the whole team to sing along.
// Saved to the website's lyrics library, so the website's Lyrics page has it too.
export default function LyricsEditorScreen({ route, navigation }: StackProps<'LyricsEditor'>) {
  const { lyricsId, scheduleId, link } = route.params;
  const { profile, home } = useSession();
  const { colors: c } = useTheme();
  const s = useStyles();
  const dialog = useDialog();
  const existing = scheduleId ? cachedLyrics(scheduleId)?.songs.find((x) => x.lyrics && x.lyrics.id === lyricsId)?.lyrics || null : null;
  const [title, setTitle] = useState(existing?.title || route.params.title || '');
  const [text, setText] = useState(existing ? toText(existing.sections) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const leaving = useRef(false);
  const lineup = scheduleId ? findLineup(home, scheduleId) : null;

  useLayoutEffect(() => { navigation.setOptions({ title: existing ? 'Edit Lyrics' : 'Add Lyrics' }); }, [navigation, existing]);

  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirty.current || leaving.current) return;
    e.preventDefault();
    dialog.confirm({
      icon: 'triangle-exclamation', tone: 'danger', title: 'Discard changes?',
      message: 'These lyrics are not saved yet.', confirmText: 'Discard', cancelText: 'Keep editing',
    }).then((ok) => { if (ok) { leaving.current = true; navigation.dispatch(e.data.action); } });
  }), [navigation, dialog]);

  if (!profile?.canEditLyrics) {
    return <Screen stacked><EmptyState icon="lock" title="Media team only" text="Only the Media team writes the lyrics." /></Screen>;
  }

  const addPart = (label: string) => {
    dirty.current = true;
    setText((t) => `${t.trimEnd()}${t.trim() ? '\n\n' : ''}[${label}]\n`);
  };

  const save = async () => {
    if (!title.trim()) return setError('The song needs a title.');
    if (!text.trim()) return setError('Type or paste the lyrics first.');
    setError(null);
    setSaving(true);
    const res = await api.saveLyrics({ id: existing?.id, title: title.trim(), link, text, scheduleDate: lineup?.date });
    setSaving(false);
    if (!res.ok) return setError(res.message);
    if (scheduleId) invalidateLyrics(scheduleId); else invalidateLyrics();
    leaving.current = true;
    navigation.goBack();
  };

  return (
    <Screen stacked>
      <Card raised style={s.intro}>
        <Icon name="align-left" size={18} color={c.goldText} />
        <Text style={s.help}>
          Type or paste the words. Start each part with its name in brackets, like [Verse 1] or [Chorus]. The whole team sees them under Lyrics as soon as you save.
        </Text>
      </Card>

      <Field label="Song" value={title} onChangeText={(v) => { dirty.current = true; setTitle(v); }} maxLength={150} />

      <Text style={s.label}>Add a part</Text>
      <View style={s.parts}>
        {PARTS.map((p) => (
          <Pressable key={p} onPress={() => addPart(p)} style={({ pressed }) => [s.part, pressed && s.pressed]} accessibilityRole="button" accessibilityLabel={`Add ${p}`}>
            <Icon name="plus" size={9} color={c.goldText} /><Text style={s.partText}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <Field
        label="Lyrics"
        value={text}
        onChangeText={(v) => { dirty.current = true; setText(v); }}
        multiline
        placeholder={'[Verse 1]\nFirst line\nSecond line\n\n[Chorus]\n...'}
        style={s.lyrics}
        maxLength={20000}
        autoCapitalize="sentences"
      />

      {error && <Banner tone="danger" text={error} />}
      <Button title="Save Lyrics" icon="floppy-disk" onPress={save} loading={saving} />
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  intro: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  help: { flex: 1, color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.regular, lineHeight: 19 },
  label: { color: c.textSecondary, fontSize: font.sm, fontFamily: fonts.semibold, marginBottom: 6 },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: space.md },
  part: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.goldMuted },
  partText: { color: c.goldText, fontSize: font.xs, fontFamily: fonts.semibold },
  pressed: { opacity: 0.7 },
  lyrics: { minHeight: 320, fontSize: font.md, lineHeight: 23 },
}));
