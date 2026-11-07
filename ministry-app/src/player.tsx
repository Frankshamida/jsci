// ============================================================
// The song player: one YouTube player for the whole app.
// A lineup's songs play here (tap the play button by a song). It lives above
// every screen as a mini player - on the tab bar, or at the bottom of a
// screen - so a song keeps playing while you read its lyrics or look around.
// Tap it to open it bigger; it moves on to the lineup's next song by itself.
//
// The video plays in a small web view (a frame in the web app) showing the
// website's player page (web/public/ministry-player.html), driven with
// window.cmd({...}) - see playerEngine.tsx / playerEngine.web.tsx.
//   usePlayer()            play a list, pause, next, close; what is playing
//   usePlayerTime()        position and length (changes twice a second)
//   useMiniPlayerInset()   room a screen keeps free at its bottom for it
// ============================================================
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ENGINE_NEEDS_TAP, PlayerEngine, type EngineHandle } from './playerEngine';
import { API_BASE_URL } from './config';
import { Icon } from './icons';
import { font, fonts, makeStyles, radius, space, tint, useTheme } from './theme';
import { formatClock } from './utils';

const PLAYER_PAGE = `${API_BASE_URL}/ministry-player.html`;
const MINI_HEIGHT = 66;

export interface Track {
  key: string;       // unique in the app (scheduleId + song), to know which row is playing
  videoId: string;
  title: string;
  subtitle?: string; // "Fast Song · Nov 15"
  link: string;      // opened in YouTube when the video cannot play here
}

export type PlayState = 'loading' | 'playing' | 'paused' | 'ended' | 'error';

interface PlayerApi {
  queue: Track[];
  index: number;
  current: Track | null;
  state: PlayState;
  error: string | null;
  expanded: boolean;
  play: (queue: Track[], index: number) => void; // the current song again toggles pause
  toggle: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  close: () => void;
  setExpanded: (open: boolean) => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);
const TimeContext = createContext({ position: 0, duration: 0 });
// The web view, held by the provider and drawn by <MiniPlayer>.
const EngineContext = createContext<{
  engineRef: React.MutableRefObject<EngineHandle | null>;
  firstVideo: string | null;
  onMessage: (data: string) => void;
} | null>(null);

export function usePlayer(): PlayerApi {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer must be inside <PlayerProvider>');
  return value;
}
export const usePlayerTime = () => useContext(TimeContext);

// Room for the mini player at the bottom of a screen (0 when nothing plays).
export function useMiniPlayerInset(): number {
  const player = useContext(PlayerContext);
  return player?.current ? MINI_HEIGHT + space.md : 0;
}

// Why a video cannot play here (YouTube's error codes).
function errorText(code: unknown): string {
  if (code === 101 || code === 150 || code === 153) return 'The owner does not allow this video to play in other apps.';
  if (code === 100) return 'This video was removed or made private.';
  if (code === 'offline') return 'No connection. Check your internet.';
  return 'This video cannot play here.';
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const engineRef = useRef<EngineHandle | null>(null);
  const ready = useRef(false);
  const pending = useRef<Track | null>(null);
  const [firstVideo, setFirstVideo] = useState<string | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<PlayState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [time, setTime] = useState({ position: 0, duration: 0 });
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(0);
  // Opened big only so a browser can be tapped to start: small again once playing.
  const autoExpanded = useRef(false);

  const send = useCallback((cmd: object) => { engineRef.current?.send(cmd); }, []);

  const start = useCallback((list: Track[], i: number) => {
    const track = list[i];
    if (!track) return;
    // In a browser the first song may need a tap on the video: show it big.
    if (ENGINE_NEEDS_TAP && !queueRef.current.length) { autoExpanded.current = true; setExpanded(true); }
    queueRef.current = list;
    indexRef.current = i;
    setQueue(list);
    setIndex(i);
    setState('loading');
    setError(null);
    setTime({ position: 0, duration: 0 });
    if (!firstVideo && !ready.current) { setFirstVideo(track.videoId); return; } // the page loads with it
    if (ready.current) send({ type: 'load', videoId: track.videoId, autoplay: true });
    else pending.current = track;
  }, [firstVideo, send]);

  const current = queue[index] || null;

  const play = useCallback((list: Track[], i: number) => {
    const track = list[i];
    if (current && track && track.key === current.key && state !== 'error') {
      if (state === 'playing' || state === 'loading') send({ type: 'pause' });
      else if (state === 'ended') send({ type: 'seek', seconds: 0 });
      else send({ type: 'play' });
      if (state === 'ended') send({ type: 'play' });
      return;
    }
    start(list, i);
  }, [current, state, send, start]);

  const toggle = useCallback(() => {
    if (!current) return;
    if (state === 'error') { start(queueRef.current, indexRef.current); return; }
    if (state === 'playing' || state === 'loading') send({ type: 'pause' });
    else { if (state === 'ended') send({ type: 'seek', seconds: 0 }); send({ type: 'play' }); }
  }, [current, state, send, start]);

  const pause = useCallback(() => { if (state === 'playing' || state === 'loading') send({ type: 'pause' }); }, [state, send]);
  const next = useCallback(() => { if (indexRef.current < queueRef.current.length - 1) start(queueRef.current, indexRef.current + 1); }, [start]);
  const prev = useCallback(() => {
    if (time.position > 4 || indexRef.current === 0) send({ type: 'seek', seconds: 0 });
    else start(queueRef.current, indexRef.current - 1);
  }, [time.position, send, start]);
  const seek = useCallback((seconds: number) => send({ type: 'seek', seconds }), [send]);

  const close = useCallback(() => {
    send({ type: 'stop' });
    ready.current = false;
    pending.current = null;
    queueRef.current = [];
    setQueue([]);
    setIndex(0);
    setFirstVideo(null); // the web view goes away; the next song starts it again
    autoExpanded.current = false;
    setExpanded(false);
    setTime({ position: 0, duration: 0 });
  }, [send]);

  const onMessage = useCallback((data: string) => {
    let msg: { type?: string; state?: string; current?: number; duration?: number; code?: unknown };
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'ready') {
      ready.current = true;
      const waiting = pending.current;
      pending.current = null;
      if (waiting) send({ type: 'load', videoId: waiting.videoId, autoplay: true });
    } else if (msg.type === 'state') {
      if (msg.state === 'playing') {
        setState('playing');
        setError(null);
        if (autoExpanded.current) { autoExpanded.current = false; setExpanded(false); } // back to the bar; the song keeps playing
      }
      else if (msg.state === 'paused') setState('paused');
      else if (ENGINE_NEEDS_TAP && (msg.state === 'unstarted' || msg.state === 'cued')) setState('paused'); // waits for a tap on the video
      else if (msg.state === 'buffering' || msg.state === 'unstarted') setState((s) => (s === 'paused' ? s : 'loading'));
      else if (msg.state === 'ended') {
        // On to the next song of the lineup, if there is one.
        if (indexRef.current < queueRef.current.length - 1) start(queueRef.current, indexRef.current + 1);
        else setState('ended');
      }
    } else if (msg.type === 'time') {
      setTime((t) => {
        const position = msg.current || 0;
        const duration = msg.duration || t.duration;
        return Math.abs(position - t.position) < 0.25 && duration === t.duration ? t : { position, duration };
      });
    } else if (msg.type === 'error') {
      setState('error');
      setError(errorText(msg.code));
    }
  }, [send, start]);

  // Opening or closing it by hand ends the automatic size change.
  const setOpen = useCallback((open: boolean) => { autoExpanded.current = false; setExpanded(open); }, []);

  const api = useMemo<PlayerApi>(() => ({
    queue, index, current, state, error, expanded, play, toggle, pause, next, prev, seek, close, setExpanded: setOpen,
  }), [queue, index, current, state, error, expanded, play, toggle, pause, next, prev, seek, close, setOpen]);

  const engine = useMemo(() => ({ engineRef, firstVideo, onMessage }), [firstVideo, onMessage]);

  return (
    <PlayerContext.Provider value={api}>
      <TimeContext.Provider value={time}>
        <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>
      </TimeContext.Provider>
    </PlayerContext.Provider>
  );
}

// The player on screen: a bar on the tab bar (or at the bottom of a screen),
// opened into a card with a bigger video, a seek bar and the controls.
export function MiniPlayer({ onTabs, tabBarHeight }: { onTabs: boolean; tabBarHeight: number }) {
  const player = useContext(PlayerContext);
  const engine = useContext(EngineContext);
  const { position, duration } = usePlayerTime();
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const s = useStyles();
  if (!player?.current || !engine?.firstVideo) return null;

  const { current, state, error, expanded, queue, index } = player;
  // tabBarHeight is the whole tab bar, home-indicator room included.
  const bottom = (onTabs ? tabBarHeight : insets.bottom) + space.sm;
  const playing = state === 'playing';
  const progress = duration ? Math.min(1, position / duration) : 0;
  const hasNext = index < queue.length - 1;

  const seekAt = (e: GestureResponderEvent, width: number) => {
    if (!duration || !width) return;
    player.seek(Math.max(0, Math.min(duration, (e.nativeEvent.locationX / width) * duration)));
  };

  const playButton = (big: boolean) => (
    <Pressable onPress={player.toggle} hitSlop={8} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}
      style={({ pressed }) => [big ? s.playBig : s.playSmall, pressed && s.pressed]}>
      <LinearGradient colors={c.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.playFill}>
        {state === 'loading'
          ? <ActivityIndicator size="small" color="#ffffff" />
          : <Icon name={state === 'error' ? 'rotate-right' : playing ? 'pause' : 'play'} size={big ? 20 : 15} color="#ffffff" style={!playing && state !== 'error' ? s.playNudge : undefined} />}
      </LinearGradient>
    </Pressable>
  );

  return (
    <View style={[s.card, expanded ? s.cardBig : s.cardMini, { bottom, left: space.sm + insets.left, right: space.sm + insets.right }]} pointerEvents="box-none">
      {/* The video. Same place in the tree open or closed, so it never restarts. */}
      <View style={expanded ? s.videoBig : s.videoMini} pointerEvents={ENGINE_NEEDS_TAP ? 'auto' : 'none'}>
        <PlayerEngine
          uri={`${PLAYER_PAGE}?v=${encodeURIComponent(engine.firstVideo)}&autoplay=1`}
          onMessage={engine.onMessage}
          handleRef={engine.engineRef}
          style={s.web}
        />
        {state === 'error' && <View style={s.videoError}><Icon name="video-slash" size={expanded ? 26 : 16} color="#ffffff" /></View>}
      </View>

      {expanded ? (
        <View style={s.bigBody}>
          <View style={s.bigHead}>
            <View style={s.flex}>
              <Text style={s.bigTitle} numberOfLines={2}>{current.title}</Text>
              {current.subtitle ? <Text style={s.sub} numberOfLines={1}>{current.subtitle}</Text> : null}
            </View>
            <Pressable onPress={() => player.setExpanded(false)} hitSlop={10} style={s.roundBtn} accessibilityRole="button" accessibilityLabel="Make the player small">
              <Icon name="chevron-down" size={15} color={c.textSecondary} />
            </Pressable>
          </View>
          {error ? (
            <View style={s.errorRow}>
              <Text style={s.errorText}>{error}</Text>
              <Pressable onPress={() => Linking.openURL(current.link)} style={s.ytLink} accessibilityRole="link">
                <Icon name="youtube" size={14} color="#ff0033" /><Text style={s.ytText}>Open in YouTube</Text>
              </Pressable>
            </View>
          ) : (
            <SeekBar progress={progress} onSeek={seekAt} position={position} duration={duration} />
          )}
          <View style={s.controls}>
            <Pressable onPress={player.close} hitSlop={10} style={s.roundBtn} accessibilityRole="button" accessibilityLabel="Stop and close">
              <Icon name="xmark" size={15} color={c.textSecondary} />
            </Pressable>
            <Pressable onPress={player.prev} hitSlop={10} style={s.roundBtn} accessibilityRole="button" accessibilityLabel="Previous song">
              <Icon name="backward-step" size={17} color={c.text} />
            </Pressable>
            {playButton(true)}
            <Pressable onPress={player.next} disabled={!hasNext} hitSlop={10} style={[s.roundBtn, !hasNext && s.dim]} accessibilityRole="button" accessibilityLabel="Next song">
              <Icon name="forward-step" size={17} color={c.text} />
            </Pressable>
            <Pressable onPress={() => Linking.openURL(current.link)} hitSlop={10} style={s.roundBtn} accessibilityRole="link" accessibilityLabel="Open in YouTube">
              <Icon name="youtube" size={16} color="#ff0033" />
            </Pressable>
          </View>
          {queue.length > 1 && <Text style={s.queueText}>Song {index + 1} of {queue.length}{hasNext ? ` · next: ${queue[index + 1].title}` : ''}</Text>}
        </View>
      ) : (
        <>
          <Pressable onPress={() => player.setExpanded(true)} style={s.miniText} accessibilityRole="button" accessibilityLabel={`${current.title}. Open the player`}>
            <Text style={s.miniTitle} numberOfLines={1}>{current.title}</Text>
            <Text style={[s.sub, error && { color: c.danger }]} numberOfLines={1}>
              {error ? 'Cannot play here · tap for YouTube' : ENGINE_NEEDS_TAP && state === 'paused' && position === 0 ? 'Tap the video to play' : current.subtitle || 'Now playing'}
            </Text>
          </Pressable>
          {playButton(false)}
          <Pressable onPress={player.next} disabled={!hasNext} hitSlop={8} style={[s.miniBtn, !hasNext && s.dim]} accessibilityRole="button" accessibilityLabel="Next song">
            <Icon name="forward-step" size={15} color={c.text} />
          </Pressable>
          <Pressable onPress={player.close} hitSlop={8} style={s.miniBtn} accessibilityRole="button" accessibilityLabel="Stop and close">
            <Icon name="xmark" size={15} color={c.textSecondary} />
          </Pressable>
          <View style={s.miniTrack} pointerEvents="none"><View style={[s.miniFill, { width: `${progress * 100}%` }]} /></View>
        </>
      )}
    </View>
  );
}

function SeekBar({ progress, position, duration, onSeek }: {
  progress: number; position: number; duration: number; onSeek: (e: GestureResponderEvent, width: number) => void;
}) {
  const s = useStyles();
  const [width, setWidth] = useState(0);
  return (
    <View>
      <Pressable onPress={(e) => onSeek(e, width)} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} hitSlop={{ top: 12, bottom: 12 }} style={s.seek} accessibilityRole="adjustable" accessibilityLabel="Song position">
        <View style={s.seekTrack}><View style={[s.seekFill, { width: `${progress * 100}%` }]} /></View>
        <View style={[s.seekKnob, { left: Math.max(0, progress * width - 7) }]} />
      </Pressable>
      <View style={s.times}>
        <Text style={s.time}>{formatClock(position)}</Text>
        <Text style={s.time}>{duration ? formatClock(duration) : '--:--'}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  dim: { opacity: 0.35 },
  card: {
    position: 'absolute', left: space.sm, right: space.sm,
    backgroundColor: c.cardRaised,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: tint(c.secondary, 0.4),
    boxShadow: c.scheme === 'light' ? '0px 6px 22px rgba(0, 0, 0, 0.16)' : '0px 6px 22px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
  },
  cardMini: { height: MINI_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingLeft: 7, paddingRight: 6, gap: 8 },
  cardBig: { padding: space.md },
  videoMini: { width: 92, height: 52, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: '#000000' },
  videoBig: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  videoError: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.6)' },
  miniText: { flex: 1, justifyContent: 'center', height: '100%' },
  miniTitle: { color: c.text, fontSize: font.md, fontFamily: fonts.bold },
  sub: { color: c.textSecondary, fontSize: font.xs, fontFamily: fonts.medium, marginTop: 1 },
  miniBtn: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  miniTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: tint(c.secondary, 0.18) },
  miniFill: { height: '100%', backgroundColor: c.secondary },
  playSmall: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
  playBig: { width: 58, height: 58, borderRadius: 29, overflow: 'hidden' },
  playFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  playNudge: { marginLeft: 2 },
  bigBody: { paddingTop: space.md },
  bigHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.sm },
  bigTitle: { color: c.text, fontSize: font.lg, fontFamily: fonts.bold },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm, paddingHorizontal: space.xs },
  seek: { height: 24, justifyContent: 'center' },
  seekTrack: { height: 4, borderRadius: 2, backgroundColor: tint(c.secondary, 0.2), overflow: 'hidden' },
  seekFill: { height: '100%', backgroundColor: c.secondary },
  seekKnob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: c.secondary, top: 5 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.medium },
  queueText: { color: c.textMuted, fontSize: font.xs, fontFamily: fonts.regular, textAlign: 'center', marginTop: space.sm },
  errorRow: { gap: 6, marginBottom: space.xs },
  errorText: { color: c.danger, fontSize: font.sm, fontFamily: fonts.medium },
  ytLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  ytText: { color: c.text, fontSize: font.sm, fontFamily: fonts.semibold },
}));
