'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSongSource } from '@/lib/songCache';
import { STORY_MUSIC_LENGTHS, loadStoryImage } from '@/lib/storyCard';
import { formatTime } from '@/components/songPlayer/useSongPlayer';

// Music on an event story, the way Instagram does it: pick a song from the
// Song Playlist, drag along its waveform to choose the part, pick 10 / 15 /
// 30 / 60 seconds, hear it, done. The story then saves as a video with that
// part of the song (lib/storyCard.js recordStory).
//
// The song comes through songCache - the same one copy per phone the players
// use - so putting a song on a story costs Cloudinary nothing if it has been
// played here before, and at most one download if not.

const BARS = 72;

/** One AudioContext per story, made on a tap so the browser lets it play. */
export function makeAudioContext() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  return AC ? new AC() : null;
}

const decode = (ctx, data) => new Promise((resolve, reject) => {
  // Older Safari only has the callback form.
  const p = ctx.decodeAudioData(data, resolve, reject);
  if (p && typeof p.then === 'function') p.then(resolve, reject);
});

// The song's sound, decoded, plus the waveform heights and the cover for the
// sticker. Loaded songs are kept for the visit, so going back to one is instant.
const loaded = new Map();
export function loadStoryMusic(ctx, song, { signal } = {}) {
  if (loaded.has(song.id)) return loaded.get(song.id);
  const job = (async () => {
    const { src } = await getSongSource(song.stream_url, { signal });
    try {
      const data = await (await fetch(src, { signal })).arrayBuffer();
      const buffer = await decode(ctx, data);
      const ch = buffer.getChannelData(0);
      const step = Math.floor(ch.length / BARS) || 1;
      const peaks = [];
      for (let i = 0; i < BARS; i += 1) {
        let sum = 0;
        for (let j = i * step; j < (i + 1) * step && j < ch.length; j += 16) sum += Math.abs(ch[j]);
        peaks.push(sum / (step / 16));
      }
      const top = Math.max(...peaks) || 1;
      const cover = await loadStoryImage(song.cover_thumb_url || song.cover_url).catch(() => null);
      return { buffer, peaks: peaks.map((v) => Math.max(0.12, v / top)), cover };
    } finally {
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    }
  })();
  loaded.set(song.id, job);
  job.catch(() => loaded.delete(song.id));
  return job;
}

/** Plays a part of a song over and over - the preview. */
export function useSegmentPreview(ctx) {
  const nodeRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [startedAt, setStartedAt] = useState(0);

  const stop = () => {
    try { nodeRef.current?.stop(); } catch { /* already stopped */ }
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    setPlaying(false);
  };
  const play = async (buffer, start, duration) => {
    if (!ctx || !buffer) return;
    stop();
    if (ctx.state === 'suspended') await ctx.resume();
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.loopStart = start;
    node.loopEnd = Math.min(buffer.duration, start + duration);
    node.connect(ctx.destination);
    node.start(0, start);
    nodeRef.current = node;
    setStartedAt(ctx.currentTime);
    setPlaying(true);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return { playing, play, stop, startedAt };
}

// The card in the story tools once music is chosen.
export function MusicCard({ music, preview, onEdit, onRemove, disabled }) {
  const { song, start, duration } = music;
  const toggle = () => (preview.playing ? preview.stop() : preview.play(music.buffer, start, duration));
  return (
    <div className="ep-music-card">
      <img src={song.cover_thumb_url || song.cover_url} alt="" />
      <div className="ep-music-card-text">
        <strong>{song.title}</strong>
        <span>{song.artist} &middot; {formatTime(start)}–{formatTime(start + duration)} ({duration}s)</span>
      </div>
      <button type="button" className="ep-music-icon" onClick={toggle} disabled={disabled} aria-label={preview.playing ? 'Stop preview' : 'Play preview'}>
        <i className={`fas ${preview.playing ? 'fa-pause' : 'fa-play'}`}></i>
      </button>
      <button type="button" className="ep-music-icon" onClick={onEdit} disabled={disabled} aria-label="Change music"><i className="fas fa-pen"></i></button>
      <button type="button" className="ep-music-icon danger" onClick={onRemove} disabled={disabled} aria-label="Remove music"><i className="fas fa-trash"></i></button>
    </div>
  );
}

// Choose a song, then the part of it. Rendered over the story panel.
export function MusicPicker({ ctx, initial, onDone, onClose }) {
  const [songs, setSongs] = useState(null); // null = loading
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [song, setSong] = useState(initial?.song || null);
  const [track, setTrack] = useState(initial ? { buffer: initial.buffer, peaks: initial.peaks, cover: initial.cover } : null);
  const [loadingId, setLoadingId] = useState(null);
  const [duration, setDuration] = useState(initial?.duration || 15);
  const [start, setStart] = useState(initial?.start || 0);
  const preview = useSegmentPreview(ctx);
  const abortRef = useRef(null);

  useEffect(() => {
    let live = true;
    fetch('/api/song-playlist/public')
      .then((r) => r.json())
      .then((json) => {
        if (!live) return;
        if (!json.success) throw new Error(json.message);
        setPaused(!!json.paused);
        setSongs(json.data || []);
      })
      .catch(() => { if (live) { setSongs([]); setError('Could not load the music. Check your connection.'); } });
    return () => { live = false; abortRef.current?.abort(); };
  }, []);

  const length = track?.buffer?.duration || Number(song?.duration_seconds) || 0;
  const lengths = STORY_MUSIC_LENGTHS.filter((l) => l <= Math.max(length, STORY_MUSIC_LENGTHS[0]));
  const clampStart = (v, d = duration) => Math.max(0, Math.min(Math.max(0, length - d), v));

  const pick = async (s) => {
    preview.stop();
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError('');
    setLoadingId(s.id);
    try {
      if (ctx?.state === 'suspended') await ctx.resume();
      const t = await loadStoryMusic(ctx, s, { signal: ctrl.signal });
      const len = t.buffer.duration;
      const d = STORY_MUSIC_LENGTHS.filter((l) => l <= Math.max(len, 10)).includes(duration) ? duration : 10;
      // Start a quarter of the way in - usually past the intro.
      const st = Math.max(0, Math.min(len - d, Math.round(len * 0.25)));
      setSong(s);
      setTrack(t);
      setDuration(Math.min(d, len));
      setStart(st);
      preview.play(t.buffer, st, Math.min(d, len));
    } catch (e) {
      if (e?.name !== 'AbortError') setError('Could not load that song. Try again.');
    } finally {
      setLoadingId(null);
    }
  };

  // Dragging the waveform moves the chosen part, like Instagram's trimmer.
  const stripRef = useRef(null);
  const dragRef = useRef(null);
  const secondsPerPx = () => (stripRef.current ? length / stripRef.current.getBoundingClientRect().width : 0);
  const onDown = (e) => {
    if (!track) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const r = stripRef.current.getBoundingClientRect();
    const at = ((e.clientX - r.left) / r.width) * length;
    // A tap outside the window jumps the window there.
    const inside = at >= start && at <= start + duration;
    const st = inside ? start : clampStart(at - duration / 2);
    setStart(st);
    dragRef.current = { x: e.clientX, start: st };
    preview.stop();
  };
  const onMove = (e) => {
    if (!dragRef.current) return;
    setStart(clampStart(dragRef.current.start + (e.clientX - dragRef.current.x) * secondsPerPx()));
  };
  const onUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    preview.play(track.buffer, start, duration);
  };

  const setLength = (d) => {
    const nd = Math.min(d, length || d);
    const st = clampStart(start, nd);
    setDuration(nd);
    setStart(st);
    if (track) preview.play(track.buffer, st, nd);
  };

  // The playhead inside the window while the preview plays.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!preview.playing) return undefined;
    let id = 0;
    const loop = () => { tick((n) => n + 1); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [preview.playing]);
  const played = preview.playing && ctx ? ((ctx.currentTime - preview.startedAt) % duration) / duration : 0;

  const q = query.trim().toLowerCase();
  const list = useMemo(
    () => (songs || []).filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q)),
    [songs, q],
  );

  const done = () => {
    preview.stop();
    onDone({ song, buffer: track.buffer, peaks: track.peaks, cover: track.cover, start, duration });
  };

  const winLeft = length ? (start / length) * 100 : 0;
  const winWidth = length ? Math.min(100, (duration / length) * 100) : 100;

  return (
    <div className="ep-music" role="dialog" aria-modal="true" aria-label="Add music" onClick={(e) => e.stopPropagation()}>
      <div className="ep-music-head">
        <button type="button" className="ep-music-icon" onClick={() => { preview.stop(); if (track && !initial) { setTrack(null); setSong(null); } else onClose(); }} aria-label="Back">
          <i className="fas fa-chevron-left"></i>
        </button>
        <h3><i className="fas fa-music"></i> {track ? 'Choose the part' : 'Add music'}</h3>
        <button type="button" className="ep-music-icon" onClick={() => { preview.stop(); onClose(); }} aria-label="Close"><i className="fas fa-times"></i></button>
      </div>

      {!track ? (
        <>
          <div className="ep-music-search">
            <i className="fas fa-magnifying-glass"></i>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs or artists" />
          </div>
          <div className="ep-music-list">
            {songs === null && <p className="ep-music-note"><span className="ep-spinner" /> Loading the playlist…</p>}
            {paused && <p className="ep-music-note"><i className="fas fa-circle-pause"></i> Music is resting for now. Save your story without it, or try again later.</p>}
            {error && <p className="ep-error">{error}</p>}
            {songs && !paused && !songs.length && !error && <p className="ep-music-note">No songs in the playlist yet.</p>}
            {songs && songs.length > 0 && !list.length && <p className="ep-music-note">No song matches &ldquo;{query}&rdquo;.</p>}
            {list.map((s) => (
              <button type="button" key={s.id} className="ep-music-song" onClick={() => pick(s)} disabled={!!loadingId}>
                <img src={s.cover_thumb_url || s.cover_url} alt="" loading="lazy" />
                <span className="ep-music-song-text"><strong>{s.title}</strong><small>{s.artist}</small></span>
                <span className="ep-music-song-time">{formatTime(Number(s.duration_seconds))}</span>
                {loadingId === s.id ? <span className="ep-spinner" /> : <i className="fas fa-circle-plus"></i>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="ep-music-trim">
          <div className="ep-music-now">
            <img src={song.cover_thumb_url || song.cover_url} alt="" />
            <div><strong>{song.title}</strong><small>{song.artist}</small></div>
            <button type="button" className="ep-music-play" onClick={() => (preview.playing ? preview.stop() : preview.play(track.buffer, start, duration))} aria-label={preview.playing ? 'Pause preview' : 'Play preview'}>
              <i className={`fas ${preview.playing ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
          </div>

          <div className="ep-music-lengths" role="radiogroup" aria-label="Length">
            {STORY_MUSIC_LENGTHS.map((l) => (
              <button type="button" key={l} role="radio" aria-checked={duration === l} className={duration === l ? 'active' : ''} disabled={!lengths.includes(l)} onClick={() => setLength(l)}>
                {l}s
              </button>
            ))}
          </div>

          <div
            className="ep-music-wave"
            ref={stripRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {track.peaks.map((h, i) => {
              const at = ((i + 0.5) / BARS) * 100;
              const inWin = at >= winLeft && at <= winLeft + winWidth;
              // eslint-disable-next-line react/no-array-index-key
              return <span key={i} className={inWin ? 'in' : ''} style={{ height: `${h * 100}%` }} />;
            })}
            <span className="ep-music-window" style={{ left: `${winLeft}%`, width: `${winWidth}%` }}>
              {preview.playing && <span className="ep-music-head-line" style={{ left: `${played * 100}%` }} />}
            </span>
          </div>
          <p className="ep-music-range">
            <strong>{formatTime(start)} – {formatTime(start + duration)}</strong>
            <span>Drag to choose the part of the song</span>
          </p>

          <button type="button" className="ep-btn ep-btn-story ep-music-done" onClick={done}>
            <i className="fas fa-check"></i> Use this part
          </button>
          <button type="button" className="ep-link" onClick={() => { preview.stop(); setTrack(null); setSong(null); }}>
            Choose another song
          </button>
        </div>
      )}
    </div>
  );
}
