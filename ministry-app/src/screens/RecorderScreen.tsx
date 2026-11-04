import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import {
  AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useLineup } from '../lineups';
import { api } from '../api';
import { invalidateRecordings } from '../recordings';
import type { StackProps } from '../routes';
import { Banner, Button, Card, ChoiceRow, EmptyState, Field, Screen } from '../components';
import { colors, font, radius, space } from '../theme';
import { MAX_RECORDING_SECONDS, MAX_UPLOAD_BYTES } from '../config';
import { formatBytes, formatClock, shortDate } from '../utils';

// Voice practice needs little: mono AAC at 48 kbps is about 360 KB a minute,
// so the 10-minute limit stays under the 4.4 MB upload limit.
const VOICE: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 48000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/webm', bitsPerSecond: 48000 },
};

type Mode = 'record' | 'file';
type SongType = 'Slow Song' | 'Fast Song';
const SONG_TYPES: SongType[] = ['Slow Song', 'Fast Song'];
interface Take { uri: string; name: string; mimeType: string; size?: number }

export default function RecorderScreen({ route, navigation }: StackProps<'Recorder'>) {
  const { scheduleId } = route.params;
  const lineup = useLineup(scheduleId);

  const recorder = useAudioRecorder(VOICE);
  const rec = useAudioRecorderState(recorder, 250);
  const player = useAudioPlayer(null);
  const playback = useAudioPlayerStatus(player);

  const [mode, setMode] = useState<Mode>('record');
  const [songType, setSongType] = useState<SongType>('Slow Song');
  const [title, setTitle] = useState('');
  const [take, setTake] = useState<Take | null>(null);
  const [starting, setStarting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const busy = useRef({ recording: false, take: false });
  busy.current = { recording: rec.isRecording, take: !!take };

  const seconds = Math.floor(rec.durationMillis / 1000);

  // Leaving with a recording not yet uploaded asks first.
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (done.current || (!busy.current.recording && !busy.current.take)) return;
    e.preventDefault();
    Alert.alert('Leave without uploading?', 'Your recording will be lost.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          if (busy.current.recording) await recorder.stop().catch(() => {});
          navigation.dispatch(e.data.action);
        },
      },
    ]);
  }), [navigation, recorder]);

  // Stops by itself at the limit.
  useEffect(() => { if (rec.isRecording && seconds >= MAX_RECORDING_SECONDS) stop(); }, [rec.isRecording, seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lineup) return <Screen stacked><EmptyState icon="alert-circle-outline" title="Lineup not found" /></Screen>;
  if (!lineup.mine) return <Screen stacked><EmptyState icon="lock-closed-outline" title="Not on this lineup" text="You can add recordings to your own lineups only." /></Screen>;

  const songsOfType = (songType === 'Slow Song' ? lineup.slowSongs : lineup.fastSongs).map((x) => x.title).filter(Boolean);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('JSCI Ministry needs the microphone to record. Allow it in your phone settings.');
        return;
      }
      player.pause();
      setTake(null);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setError('Could not start recording. Close other apps using the microphone and try again.');
    } finally {
      setStarting(false);
    }
  };

  async function stop() {
    try {
      await recorder.stop();
    } catch { /* already stopped */ }
    // Back to the loudspeaker for playback (iOS plays through the earpiece while recording is on).
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    if (!uri) return setError('The recording could not be saved. Please try again.');
    setTake({ uri, name: `practice-${lineup!.date}-${Date.now()}.m4a`, mimeType: 'audio/mp4' });
    player.replace({ uri });
  }

  const pickFile = async () => {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const file = res.assets[0];
    if (file.size && file.size > MAX_UPLOAD_BYTES) {
      return setError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)} — record a shorter part or use the recorder.`);
    }
    player.pause();
    setTake({ uri: file.uri, name: file.name || `practice-${Date.now()}.m4a`, mimeType: file.mimeType || 'audio/mpeg', size: file.size });
    player.replace({ uri: file.uri });
    if (!title.trim() && file.name) setTitle(file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120));
  };

  const togglePreview = () => {
    if (playback.playing) return player.pause();
    if (playback.didJustFinish || (playback.duration && playback.currentTime >= playback.duration - 0.2)) player.seekTo(0);
    player.play();
  };

  const discard = () => { player.pause(); setTake(null); };

  const upload = async () => {
    if (!take) return;
    if (!title.trim()) return setError('Give the recording a title, like the song name.');
    setError(null);
    setUploading(true);
    player.pause();
    const res = await api.uploadRecording({ ...take, scheduleId, songType, title: title.trim() });
    setUploading(false);
    if (!res.ok) return setError(res.message);
    invalidateRecordings(scheduleId);
    done.current = true;
    navigation.goBack();
  };

  const left = MAX_RECORDING_SECONDS - seconds;

  return (
    <Screen stacked>
      <Text style={s.date}>Practice for {shortDate(lineup.date)}</Text>

      <Text style={s.label}>Song type</Text>
      <ChoiceRow options={SONG_TYPES} value={songType} onChange={setSongType} />

      <Field label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Way Maker – harmony part" maxLength={120} />
      {songsOfType.length > 0 && !title && (
        <View style={s.suggest}>
          {songsOfType.map((t) => (
            <Pressable key={t} onPress={() => setTitle(t)} style={s.suggestChip}><Text style={s.suggestText}>{t}</Text></Pressable>
          ))}
        </View>
      )}

      <ChoiceRow options={['record', 'file'] as Mode[]} value={mode} onChange={(m) => { if (!rec.isRecording) { discard(); setMode(m); } }} labels={{ record: 'Record now', file: 'Upload a file' }} />

      <Card style={s.stage}>
        {take ? (
          <>
            <Pressable onPress={togglePreview} style={s.bigPlay} accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pause' : 'Play recording'}>
              <Ionicons name={playback.playing ? 'pause' : 'play'} size={38} color={colors.textOnGold} />
            </Pressable>
            <Text style={s.clock}>
              {formatClock(playback.currentTime)}{playback.duration ? ` / ${formatClock(playback.duration)}` : ''}
            </Text>
            <Text style={s.muted} numberOfLines={1}>{mode === 'file' ? take.name : 'Listen before you upload'}{take.size ? ` · ${formatBytes(take.size)}` : ''}</Text>
            <Button compact variant="secondary" icon={mode === 'file' ? 'folder-open-outline' : 'refresh'} title={mode === 'file' ? 'Choose another file' : 'Record again'}
              onPress={mode === 'file' ? pickFile : () => { discard(); start(); }} style={s.again} />
          </>
        ) : mode === 'record' ? (
          <>
            <Pressable
              onPress={rec.isRecording ? stop : start}
              disabled={starting}
              style={[s.bigRec, rec.isRecording && s.bigRecOn]}
              accessibilityRole="button"
              accessibilityLabel={rec.isRecording ? 'Stop recording' : 'Start recording'}
            >
              <Ionicons name={rec.isRecording ? 'stop' : 'mic'} size={40} color="#fff" />
            </Pressable>
            <Text style={s.clock}>{formatClock(seconds)}</Text>
            <Text style={s.muted}>
              {rec.isRecording
                ? (left <= 60 ? `Stops by itself in ${left}s` : 'Recording… tap to stop')
                : `Tap to record (up to ${MAX_RECORDING_SECONDS / 60} minutes)`}
            </Text>
          </>
        ) : (
          <>
            <Pressable onPress={pickFile} style={s.bigFile} accessibilityRole="button" accessibilityLabel="Choose an audio file">
              <Ionicons name="cloud-upload-outline" size={38} color={colors.goldLight} />
            </Pressable>
            <Text style={s.muted}>Choose an audio file from your phone (up to {formatBytes(MAX_UPLOAD_BYTES)}).</Text>
          </>
        )}
      </Card>

      {error && <Banner tone="danger" text={error} />}
      <Button title="Upload Recording" icon="cloud-upload" onPress={upload} loading={uploading} disabled={!take || rec.isRecording} />
      <Text style={s.foot}>Everyone on this lineup can listen to it.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  date: { color: colors.text, fontSize: font.xl, fontWeight: '900', marginBottom: space.md },
  label: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '700', marginBottom: 6 },
  muted: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center', lineHeight: 19 },
  suggest: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -6, marginBottom: space.md },
  suggestChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight },
  suggestText: { color: colors.text, fontSize: font.xs, fontWeight: '600' },
  stage: { alignItems: 'center', paddingVertical: space.xl, gap: space.sm },
  bigRec: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  bigRecOn: { backgroundColor: '#b3212f', borderWidth: 4, borderColor: colors.dangerMuted },
  bigPlay: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  bigFile: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: colors.goldDark, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  clock: { color: colors.text, fontSize: font.hero, fontWeight: '900', fontVariant: ['tabular-nums'] },
  again: { marginTop: space.sm },
  foot: { color: colors.textMuted, fontSize: font.xs, textAlign: 'center', marginTop: space.sm },
});
