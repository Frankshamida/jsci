'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cachedSongUrls, getSongSource } from '@/lib/songCache';
import { loadSpotifyIframeApi, spotifyUri } from '@/lib/spotifyEmbed';

// The playback engine behind every Song Playlist player - the dashboard's
// Song Playlist and the songs under a Worship item on an event's public page.
//
// Bandwidth: nothing is fetched until play is pressed. The song then plays
// from the copy kept on this device, or is downloaded once and kept
// (songCache.js), so Cloudinary serves each song to each device once - and
// the dashboard and the event page share that one copy.
//
//   const player = useSongPlayer({ songs, order });
//   <audio {...player.audioProps} />
//
// `songs` is every song the player may play; `order` the ids in the order
// next / previous move through (the list shown, or a shuffle of it).
//
// A list may mix in songs saved from Spotify (source: 'spotify'). Those play
// in Spotify's own embedded player - Spotify allows no other way - which the
// page mounts, visible, at player.spotifyHostRef:
//   <div ref={player.spotifyHostRef} hidden={!player.isSpotify} />
// Everything else (stage, controls, next / previous, the queue) works the
// same for both: the hook drives Spotify's player through its iFrame API and
// follows what it reports.

const isSpotifySong = (song) => song?.source === 'spotify' && !!song.spotify_id;
// Spotify's player may refuse to start without a tap inside it (autoplay
// rules); after this long without sound, the listener is told where to tap.
const SPOTIFY_START_MS = 5000;

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// A tenth of a second of silence, used to unlock <audio> on iOS (see prime()).
function silentWav() {
  const rate = 8000;
  const samples = 800;
  const view = new DataView(new ArrayBuffer(44 + samples));
  const text = (at, str) => [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i += 1) view.setUint8(44 + i, 128); // 8-bit silence
  return new Blob([view.buffer], { type: 'audio/wav' });
}

export function useSongPlayer({ songs, order }) {
  const audioRef = useRef(null);
  const [currentId, setCurrentId] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingPct, setLoadingPct] = useState(null); // null, or 0..1 while a song downloads
  const [playError, setPlayError] = useState('');
  const [cachedUrls, setCachedUrls] = useState(() => new Set());

  const current = useMemo(() => songs.find((s) => s.id === currentId) || null, [songs, currentId]);

  const loadedIdRef = useRef(null);  // the song whose audio is in the <audio> element
  const loadTokenRef = useRef(0);    // bumps on every load; stale loads bail out
  const abortRef = useRef(null);
  const blobUrlRef = useRef(null);
  const silentUrlRef = useRef(null);
  const primedRef = useRef(false);
  const wantPlayRef = useRef(false); // playing, or about to be once the download lands

  const spotifyHostRef = useRef(null);   // where the page mounts Spotify's player
  const spotifyRef = useRef(null);       // its controller, once made
  const spotifyMakingRef = useRef(null); // the controller being made
  const spotifyIdRef = useRef(null);     // the song loaded into it
  const spotifyLastRef = useRef({ playing: false, position: 0, duration: 0 });
  const spotifyStartTimerRef = useRef(null);

  const isSilent = (el) => !!silentUrlRef.current && el.src === silentUrlRef.current;
  const refreshCached = () => setCachedUrls(cachedSongUrls());

  useEffect(() => { refreshCached(); }, []);

  // iOS only lets an <audio> start from a tap, and the song may still be
  // downloading when the tap is over. So the element is started on a moment of
  // silence inside the first tap, which unlocks every later play() - including
  // the automatic next song.
  const prime = () => {
    const el = audioRef.current;
    if (!el || primedRef.current) return;
    primedRef.current = true;
    if (!silentUrlRef.current) silentUrlRef.current = URL.createObjectURL(silentWav());
    el.src = silentUrlRef.current;
    el.play().catch(() => {});
  };

  const cancelLoad = () => {
    loadTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    wantPlayRef.current = false;
    setLoadingPct(null);
  };

  // Spotify's player, made the first time a Spotify song plays (with that
  // song in it). Resolves once it is ready for play().
  const makeSpotify = (uri) => {
    if (spotifyRef.current) return Promise.resolve({ controller: spotifyRef.current, fresh: false });
    if (spotifyMakingRef.current) return spotifyMakingRef.current.then((c) => ({ controller: c, fresh: false }));
    spotifyMakingRef.current = loadSpotifyIframeApi().then((api) => new Promise((resolve, reject) => {
      const host = spotifyHostRef.current;
      if (!host) { reject(new Error('Spotify songs cannot play here.')); return; }
      const el = document.createElement('div');
      host.appendChild(el);
      api.createController(el, { uri, width: '100%', height: 80 }, (controller) => {
        controller.addListener('playback_update', (e) => actionsRef.current.onSpotifyUpdate(e.data || {}));
        controller.addListener('ready', () => { spotifyRef.current = controller; resolve(controller); });
      });
    }));
    spotifyMakingRef.current.catch(() => { spotifyMakingRef.current = null; });
    return spotifyMakingRef.current.then((c) => ({ controller: c, fresh: true, uri }));
  };

  const pauseSpotify = () => {
    clearTimeout(spotifyStartTimerRef.current);
    if (spotifyIdRef.current) spotifyRef.current?.pause();
  };

  const playSpotify = async (song) => {
    const token = ++loadTokenRef.current;
    abortRef.current?.abort();
    audioRef.current?.pause();
    wantPlayRef.current = true;
    setPlayError('');
    setLoadingPct(null);
    const uri = spotifyUri(song.spotify_id);
    try {
      const made = await makeSpotify(uri);
      if (token !== loadTokenRef.current) return;
      if (!made.fresh || made.uri !== uri) made.controller.loadUri(uri);
      spotifyIdRef.current = song.id;
      spotifyLastRef.current = { playing: false, position: 0, duration: 0 };
      made.controller.play();
      clearTimeout(spotifyStartTimerRef.current);
      spotifyStartTimerRef.current = setTimeout(() => {
        if (!spotifyLastRef.current.playing) setPlayError('Tap play on the Spotify player below to start.');
      }, SPOTIFY_START_MS);
    } catch (err) {
      if (token !== loadTokenRef.current) return;
      wantPlayRef.current = false;
      setPlayError(err?.message || 'Could not play this song.');
    }
  };

  // What Spotify's player reports, a few times a second while it plays.
  const onSpotifyUpdate = (d) => {
    if (!isSpotifySong(current) || spotifyIdRef.current !== current.id) return;
    const was = spotifyLastRef.current;
    const now = {
      playing: !d.isPaused,
      position: (Number(d.position) || 0) / 1000,
      duration: (Number(d.duration) || 0) / 1000 || was.duration,
    };
    spotifyLastRef.current = now;
    setPlaying(now.playing);
    setTime(now.position);
    if (now.duration) setDuration(now.duration);
    if (now.playing) { clearTimeout(spotifyStartTimerRef.current); setPlayError(''); }
    // The end of the song: it was playing and stopped at (or reset from) the end.
    const ended = was.playing && !now.playing && was.duration > 0 && was.position >= was.duration - 1.5;
    if (ended && wantPlayRef.current) step(1, { autoplay: true });
  };

  const loadAndPlay = async (song) => {
    if (isSpotifySong(song)) { playSpotify(song); return; }
    const el = audioRef.current;
    if (!el || !song?.stream_url) return;
    pauseSpotify();
    const token = ++loadTokenRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    wantPlayRef.current = true;
    setPlayError('');
    setLoadingPct(0);
    try {
      const { src, fromCache } = await getSongSource(song.stream_url, {
        signal: ctrl.signal,
        onProgress: (p) => { if (token === loadTokenRef.current) setLoadingPct(p); },
      });
      if (token !== loadTokenRef.current) {
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
        return;
      }
      const previousBlob = blobUrlRef.current;
      blobUrlRef.current = src.startsWith('blob:') ? src : null;
      loadedIdRef.current = song.id;
      setLoadingPct(null);
      el.src = src;
      // Revoked only once the element has let go of it.
      if (previousBlob) URL.revokeObjectURL(previousBlob);
      if (!fromCache) refreshCached();
      await el.play();
    } catch (err) {
      if (token !== loadTokenRef.current || err?.name === 'AbortError') return;
      wantPlayRef.current = false;
      setLoadingPct(null);
      setPlayError(err?.name === 'NotAllowedError' ? 'Tap play to start.' : (err?.message || 'Could not play this song.'));
    }
  };

  const goTo = (id, play) => {
    const el = audioRef.current;
    setCurrentId(id);
    setTime(0);
    if (el && loadedIdRef.current === id) {
      // Same song again (a one-song list, or back to the start).
      el.currentTime = 0;
      if (play) { wantPlayRef.current = true; el.play().catch(() => {}); }
      return;
    }
    if (play) {
      loadAndPlay(songs.find((s) => s.id === id));
    } else {
      cancelLoad();
      el?.pause();
      pauseSpotify();
    }
  };

  // autoplay: the song that just ended hands over to the next one.
  const step = (dir, { autoplay = false } = {}) => {
    if (!order.length) return;
    const pos = order.indexOf(currentId);
    // The song on the record may not be in the list shown: then the list
    // starts from its first song.
    const next = pos < 0 ? order[0] : order[(pos + dir + order.length) % order.length];
    if (!autoplay) prime();
    goTo(next, autoplay || wantPlayRef.current);
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (!current) return;
    if (isSpotifySong(current)) {
      if (spotifyIdRef.current === current.id && spotifyRef.current) {
        wantPlayRef.current = !playing;
        spotifyRef.current.togglePlay();
      } else {
        loadAndPlay(current);
      }
      return;
    }
    if (!el) return;
    if (loadingPct !== null) { cancelLoad(); return; } // tap while downloading = cancel
    if (loadedIdRef.current === current.id) {
      if (el.paused) { wantPlayRef.current = true; el.play().catch(() => {}); }
      else { wantPlayRef.current = false; el.pause(); }
      return;
    }
    prime();
    loadAndPlay(current);
  };

  const playSong = (id) => {
    if (id === currentId) { togglePlay(); return; }
    prime();
    goTo(id, true);
  };

  const pause = () => {
    wantPlayRef.current = false;
    cancelLoad();
    audioRef.current?.pause();
    pauseSpotify();
  };

  const seek = (value) => {
    if (isSpotifySong(current)) {
      if (spotifyIdRef.current === currentId && Number.isFinite(value)) { spotifyRef.current?.seek(value); setTime(value); }
      return;
    }
    const el = audioRef.current;
    if (el && loadedIdRef.current === currentId && Number.isFinite(value)) { el.currentTime = value; setTime(value); }
  };

  // Takes songs off the record (they were deleted): stops them if they are
  // playing and moves to the first song that is left.
  const release = (songIds) => {
    if (!songIds.includes(currentId)) return;
    cancelLoad();
    const el = audioRef.current;
    if (el && songIds.includes(loadedIdRef.current)) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      loadedIdRef.current = null;
    }
    setCurrentId(songs.find((s) => !songIds.includes(s.id))?.id || null);
  };

  // The shown length comes from the row, so nothing has to be fetched for it.
  useEffect(() => {
    setDuration(Number(current?.duration_seconds) || 0);
    if (loadedIdRef.current !== current?.id) setTime(0);
  }, [current?.id, current?.duration_seconds]);

  useEffect(() => () => {
    loadTokenRef.current += 1;
    abortRef.current?.abort();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    if (silentUrlRef.current) URL.revokeObjectURL(silentUrlRef.current);
    clearTimeout(spotifyStartTimerRef.current);
    try { spotifyRef.current?.destroy(); } catch { /* already gone */ }
  }, []);

  // Lock-screen / notification controls on phones. Handlers go through a ref
  // so they always act on the latest state.
  const actionsRef = useRef({});
  actionsRef.current = { togglePlay, step, onSpotifyUpdate };
  useEffect(() => {
    // Spotify's player shows its own lock-screen controls.
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !current || isSpotifySong(current)) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: 'Song Playlist',
        artwork: [{ src: current.cover_label_url || current.cover_url, sizes: '360x360' }],
      });
      navigator.mediaSession.setActionHandler('play', () => actionsRef.current.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => { wantPlayRef.current = false; audioRef.current?.pause(); });
      navigator.mediaSession.setActionHandler('nexttrack', () => actionsRef.current.step(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => actionsRef.current.step(-1));
    } catch { /* not supported */ }
  }, [current]);

  const audioProps = {
    ref: audioRef,
    preload: 'none',
    onPlay: (e) => { if (!isSilent(e.currentTarget)) setPlaying(true); },
    onPause: () => setPlaying(false),
    onTimeUpdate: (e) => { if (!isSilent(e.currentTarget)) setTime(e.currentTarget.currentTime); },
    onLoadedMetadata: (e) => {
      const d = e.currentTarget.duration;
      if (!isSilent(e.currentTarget) && loadedIdRef.current === currentId && Number.isFinite(d)) setDuration(d);
    },
    onEnded: (e) => { if (!isSilent(e.currentTarget)) step(1, { autoplay: true }); },
  };

  return {
    audioProps,
    current,
    currentId,
    setCurrentId,
    playing,
    time,
    duration,
    loadingPct,
    playError,
    cachedUrls,
    refreshCached,
    spotifyHostRef,
    isSpotify: isSpotifySong(current),
    togglePlay,
    playSong,
    pause,
    step,
    seek,
    release,
  };
}
