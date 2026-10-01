'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlayerControls, SongRow, VinylStage } from '../songPlayer/PlayerParts';
import { loadSpotifyIframeApi as loadIframeApi } from '@/lib/spotifyEmbed';
import '../SongPlaylist.css';
import './SpotifyBrowser.css';

// Christian songs from Spotify (see src/lib/spotify.js and /api/spotify).
//
//   SpotifyFinder      search + daily suggestions, with a pick button per song
//   SpotifyDashboard   Song Playlist > Spotify: the saved Song List and its player
//   SpotifyPickerModal the finder in a modal, for the lineup song cards
//
// Spotify's rules for its content: songs play only in Spotify's own embedded
// player (kept visible under the controls - the sound comes from it), every
// song links back to Spotify, and Spotify is credited.
//
// To spare the API: typing is debounced, a query shorter than two letters is
// never sent, an old request is cancelled when a new one starts, and answers
// are remembered for the visit - the same search twice is one request.

const DEBOUNCE_MS = 450;
const SUGGESTIONS_KEEP_MS = 15 * 60 * 1000;

const answers = new Map(); // `${q}|${offset}` -> data, for this visit
let suggestionsMemo = null; // { at, data }
const albumMemo = new Map(); // album id (or t:<track id>) -> album, for this visit

export const spotifyEmbedUrl = (id) => `https://open.spotify.com/embed/track/${id}?utm_source=generator`;

// A saved Song List row in the same shape as a search result.
export const savedToTrack = (row) => ({
  id: row.spotify_id,
  title: row.title,
  artists: row.artists,
  album: row.album,
  image: row.image_url,
  imageSmall: row.image_url,
  url: row.external_url,
  durationMs: row.duration_ms,
  albumId: row.album_id || null,
  savedId: row.id,
});

const clock = (ms) => {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    const err = new Error(json.message || 'Could not reach Spotify.');
    err.retryAfter = json.retryAfter;
    throw err;
  }
  return json.data;
}

export function SpotifyAttribution() {
  return (
    <span className="spf-credit">
      Songs from <i className="fab fa-spotify" aria-hidden="true"></i> <strong>Spotify</strong>
    </span>
  );
}

// Spotify's own player: plays the full song for a signed-in Spotify user, a
// preview otherwise. Costs no Web API calls.
export function SpotifyEmbed({ trackId, compact }) {
  if (!trackId) return null;
  return (
    <iframe
      key={trackId}
      className="spf-embed"
      title="Spotify player"
      src={spotifyEmbedUrl(trackId)}
      width="100%"
      height={compact ? 80 : 152}
      frameBorder="0"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      loading="lazy"
    />
  );
}

// Drives Spotify's embedded player (mounted into `hostRef`) and reports what
// it is doing, so our own stage and controls can follow it.
function useSpotifyEmbed(track) {
  const hostRef = useRef(null);
  const controllerRef = useRef(null);
  const [state, setState] = useState({ playing: false, time: 0, duration: 0 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!track) return undefined;
    const uri = `spotify:track:${track.id}`;
    setState({ playing: false, time: 0, duration: (track.durationMs || 0) / 1000 });
    if (controllerRef.current) {
      controllerRef.current.loadUri(uri);
      controllerRef.current.play();
      return undefined;
    }
    let alive = true;
    loadIframeApi().then((api) => {
      if (!alive || !hostRef.current) return;
      const el = document.createElement('div');
      hostRef.current.appendChild(el);
      api.createController(el, { uri, width: '100%', height: 80 }, (controller) => {
        if (!alive) { controller.destroy(); return; }
        controllerRef.current = controller;
        controller.addListener('playback_update', (e) => {
          const d = e.data || {};
          setState({ playing: !d.isPaused, time: (d.position || 0) / 1000, duration: (d.duration || 0) / 1000 });
        });
        controller.addListener('ready', () => controller.play());
      });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the tab removes the player, which stops the song.
  useEffect(() => () => { controllerRef.current?.destroy(); controllerRef.current = null; }, []);

  return {
    ...state,
    hostRef,
    failed,
    togglePlay: () => controllerRef.current?.togglePlay(),
    seek: (sec) => { controllerRef.current?.seek(sec); setState((st) => ({ ...st, time: sec })); },
  };
}

const NO_CACHE = new Set();

// A Spotify track in the shape the Our Songs stage and rows use.
const asSong = (t) => ({
  id: t.id,
  title: t.title,
  artist: t.artists,
  cover_url: t.image,
  cover_label_url: t.image,
  cover_thumb_url: t.imageSmall || t.image,
  duration_seconds: t.durationMs ? t.durationMs / 1000 : null,
  stream_url: null,
});

function TrackRow({ track, playing, onPlay, onAlbum, action }) {
  return (
    <li className={`spf-row ${playing ? 'is-playing' : ''}`}>
      <button type="button" className="spf-art" onClick={() => onPlay?.(track)} aria-label={`Play ${track.title}`} title="Play">
        {track.imageSmall || track.image ? <img src={track.imageSmall || track.image} alt="" loading="lazy" /> : <i className="fas fa-music"></i>}
        <span className="spf-art-play"><i className={`fas ${playing ? 'fa-volume-high' : 'fa-play'}`}></i></span>
      </button>
      <span className="spf-text">
        <a href={track.url} target="_blank" rel="noreferrer" className="spf-title" title="Open in Spotify">{track.title}</a>
        <small>
          {track.artists}
          {track.album && (onAlbum
            ? <> · <button type="button" className="spf-album-link" onClick={() => onAlbum(track)} title="Show the album">{track.album}</button></>
            : ` · ${track.album}`)}
        </small>
      </span>
      {track.durationMs ? <span className="spf-time">{clock(track.durationMs)}</span> : null}
      <a className="spf-icon-btn spf-open" href={track.url} target="_blank" rel="noreferrer" aria-label="Open in Spotify" title="Open in Spotify">
        <i className="fab fa-spotify"></i>
      </a>
      {action}
    </li>
  );
}

function useSpotifySearch(actorId, query) {
  const [state, setState] = useState({ items: [], hidden: 0, hasMore: false, loading: false, error: '' });
  const [offset, setOffset] = useState(0);
  const q = query.replace(/\s+/g, ' ').trim().toLowerCase();

  useEffect(() => { setOffset(0); }, [q]);

  useEffect(() => {
    if (q.length < 2) { setState({ items: [], hidden: 0, hasMore: false, loading: false, error: '' }); return undefined; }
    const key = `${q}|${offset}`;
    const merge = (data) => setState((prev) => ({
      items: offset ? [...prev.items, ...data.items.filter((t) => !prev.items.some((p) => p.id === t.id))] : data.items,
      hidden: (offset ? prev.hidden : 0) + data.hidden,
      hasMore: data.hasMore,
      nextOffset: data.nextOffset ?? offset + 10,
      loading: false,
      error: '',
    }));
    if (answers.has(key)) { merge(answers.get(key)); return undefined; }

    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    const timer = setTimeout(async () => {
      try {
        const data = await getJson(`/api/spotify?mode=search&q=${encodeURIComponent(q)}&offset=${offset}&actorId=${encodeURIComponent(actorId || '')}`, ctrl.signal);
        answers.set(key, data);
        merge(data);
      } catch (e) {
        if (e.name === 'AbortError') return;
        setState((prev) => ({ ...prev, loading: false, error: e.message }));
      }
    }, offset ? 0 : DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q, offset, actorId]);

  return { ...state, q, loadMore: () => setOffset(state.nextOffset || offset + 10) };
}

function useSuggestions(actorId, enabled) {
  const [shelves, setShelves] = useState(suggestionsMemo?.data || null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return undefined;
    if (suggestionsMemo && Date.now() - suggestionsMemo.at < SUGGESTIONS_KEEP_MS) { setShelves(suggestionsMemo.data); return undefined; }
    const ctrl = new AbortController();
    getJson(`/api/spotify?mode=suggestions&actorId=${encodeURIComponent(actorId || '')}`, ctrl.signal)
      .then((data) => { suggestionsMemo = { at: Date.now(), data }; setShelves(data); setError(''); })
      .catch((e) => { if (e.name !== 'AbortError') { setError(e.message); setShelves([]); } });
    return () => ctrl.abort();
  }, [actorId, enabled]);
  return { shelves, error };
}

// Search box + suggestions. `renderAction(track)` draws the per-song button
// (Add to Song List, Use in lineup...).
export function SpotifyFinder({ actorId, renderAction, playingId, onPlay, onAlbum }) {
  const [query, setQuery] = useState('');
  const search = useSpotifySearch(actorId, query);
  const searching = search.q.length >= 2;
  const { shelves, error: shelfError } = useSuggestions(actorId, !searching);
  const [shelfKey, setShelfKey] = useState(null);
  const shelf = shelves?.find((s) => s.key === shelfKey) || shelves?.[0];

  const row = (track) => (
    <TrackRow key={track.id} track={track} playing={playingId === track.id} onPlay={onPlay} onAlbum={onAlbum} action={renderAction?.(track)} />
  );

  return (
    <div className="spf-finder">
      <div className="spf-search">
        <i className="fas fa-magnifying-glass"></i>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Christian songs - English, Tagalog, Bisaya" maxLength={100} />
        {query && <button type="button" className="spf-clear" onClick={() => setQuery('')} aria-label="Clear"><i className="fas fa-times"></i></button>}
      </div>
      <p className="spf-note"><i className="fas fa-shield-heart"></i> Only Christian &amp; worship songs are shown. Explicit songs are always hidden.</p>

      {searching ? (
        <>
          {search.error && <p className="spf-error"><i className="fas fa-circle-exclamation"></i> {search.error}</p>}
          {!search.loading && !search.error && search.items.length === 0 && (
            <p className="spf-empty">No Christian songs found for &ldquo;{query.trim()}&rdquo;. Try the song title with the artist.</p>
          )}
          <ul className="spf-list">{search.items.map(row)}</ul>
          {search.loading && <p className="spf-empty"><i className="fas fa-spinner fa-spin"></i> Searching Spotify...</p>}
          {!search.loading && search.hasMore && (
            <button type="button" className="sp-btn-ghost spf-more" onClick={search.loadMore}>Show more</button>
          )}
          {search.hidden > 0 && !search.loading && (
            <p className="spf-note">{search.hidden} non-worship {search.hidden === 1 ? 'result was' : 'results were'} hidden.</p>
          )}
        </>
      ) : shelves === null ? (
        <p className="spf-empty"><i className="fas fa-spinner fa-spin"></i> Loading suggestions...</p>
      ) : !shelves.length ? (
        <p className="spf-empty">{shelfError || 'No suggestions right now. Search for a song instead.'}</p>
      ) : (
        <>
          <div className="spf-shelves" role="tablist" aria-label="Suggestions">
            {shelves.map((s) => (
              <button key={s.key} type="button" role="tab" aria-selected={shelf?.key === s.key} className={`spf-shelf ${shelf?.key === s.key ? 'is-active' : ''}`} onClick={() => setShelfKey(s.key)}>
                <i className={`fas ${s.icon}`}></i> {s.title}
              </button>
            ))}
          </div>
          {shelf?.error && !shelf.items.length && <p className="spf-error"><i className="fas fa-circle-exclamation"></i> {shelf.error}</p>}
          <ul className="spf-list">{(shelf?.items || []).map(row)}</ul>
        </>
      )}
      <div className="spf-foot"><SpotifyAttribution /></div>
    </div>
  );
}

// The rest of a song's album: open it from the song playing, or by tapping an
// album name. One request per album, remembered for the visit.
function AlbumPanel({ actorId, track, playingId, onPlay, renderAction, onClose }) {
  const key = track.albumId || `t:${track.id}`;
  const [album, setAlbum] = useState(albumMemo.get(key) || null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (albumMemo.has(key)) { setAlbum(albumMemo.get(key)); setError(''); return undefined; }
    setAlbum(null);
    setError('');
    const ctrl = new AbortController();
    const which = track.albumId ? `id=${encodeURIComponent(track.albumId)}` : `track=${encodeURIComponent(track.id)}`;
    getJson(`/api/spotify?mode=album&${which}&actorId=${encodeURIComponent(actorId || '')}`, ctrl.signal)
      .then((data) => { albumMemo.set(key, data); setAlbum(data); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctrl.abort();
  }, [key, actorId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sp-list-card spf-album">
      <div className="sp-list-head">
        <h3>
          {album?.image ? <img className="sp-list-head-cover" src={album.image} alt="" /> : <i className="fas fa-compact-disc"></i>}
          <span className="spf-album-head">
            <small>From the album</small>
            <span className="sp-list-head-name">{album?.name || track.album || 'Album'}</span>
          </span>
          {album && <span className="sp-list-head-count">{album.tracks.length}</span>}
        </h3>
        <div className="sp-list-head-actions">
          {album?.url && (
            <a className="sp-icon-btn spf-open" href={album.url} target="_blank" rel="noreferrer" aria-label="Open the album in Spotify" title="Open the album in Spotify">
              <i className="fab fa-spotify"></i>
            </a>
          )}
          <button type="button" className="sp-icon-btn" onClick={onClose} aria-label="Close the album" title="Close"><i className="fas fa-times"></i></button>
        </div>
      </div>
      {!album && !error && <p className="spf-empty"><i className="fas fa-spinner fa-spin"></i> Loading the album...</p>}
      {error && <p className="spf-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}
      {album && (
        <>
          <p className="spf-note spf-album-meta">{[album.artists, album.year, `${album.totalTracks} ${album.totalTracks === 1 ? 'song' : 'songs'}`].filter(Boolean).join(' · ')}</p>
          {album.tracks.length <= 1 && <p className="spf-empty">This is a single - there are no other songs on it.</p>}
          <ul className="spf-list">
            {album.tracks.map((t) => (
              <TrackRow key={t.id} track={t} playing={playingId === t.id} onPlay={onPlay} action={renderAction?.(t)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Song Playlist > Spotify.
export function SpotifyDashboard({ actorId, canManage }) {
  const [saved, setSaved] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(null); // track
  const [busyId, setBusyId] = useState(null);
  const [showFinder, setShowFinder] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [albumOf, setAlbumOf] = useState(null); // track whose album is open
  const playerRef = useRef(null);
  const embed = useSpotifyEmbed(playing);

  const load = async () => {
    try {
      const rows = await getJson('/api/song-playlist/spotify');
      setSaved(rows.map(savedToTrack));
      setError('');
    } catch (e) {
      setError(e.message);
      setSaved([]);
    }
  };
  useEffect(() => { load(); }, []);

  const play = (track) => {
    if (!track) return;
    setPlaying(track);
    setAlbumOf(track);
    playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const savedIds = new Set((saved || []).map((t) => t.id));
  const list = saved || [];

  // Next / previous through the Song List (a random other song on shuffle).
  // A suggestion that is not in the list steps into the list from its start.
  const step = (dir) => {
    if (!list.length) return;
    const at = list.findIndex((t) => t.id === playing?.id);
    let next;
    if (shuffle && list.length > 1) {
      do { next = Math.floor(Math.random() * list.length); } while (next === at);
    } else {
      next = at < 0 ? 0 : (at + dir + list.length) % list.length;
    }
    setPlaying(list[next]);
  };

  // What PlayerControls and SongRow expect from the Our Songs player.
  const player = {
    current: playing ? asSong(playing) : null,
    currentId: playing?.id || null,
    playing: embed.playing,
    time: embed.time,
    duration: embed.duration,
    loadingPct: null,
    playError: embed.failed ? 'Use the Spotify player below to play.' : '',
    cachedUrls: NO_CACHE,
    seek: embed.seek,
    togglePlay: embed.togglePlay,
    step,
    playSong: (id) => {
      if (id === playing?.id) embed.togglePlay();
      else play(list.find((t) => t.id === id));
    },
  };

  const add = async (track) => {
    setBusyId(track.id);
    try {
      const res = await fetch('/api/song-playlist/spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, spotifyId: track.id }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      await load();
    } catch (e) {
      window.alert(e.message || 'Could not add the song.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (track) => {
    if (!window.confirm(`Remove "${track.title}" from the Song List?`)) return;
    setBusyId(track.id);
    try {
      const res = await fetch(`/api/song-playlist/spotify?id=${encodeURIComponent(track.savedId)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      if (playing?.id === track.id) setPlaying(null);
      await load();
    } catch (e) {
      window.alert(e.message || 'Could not remove the song.');
    } finally {
      setBusyId(null);
    }
  };

  const addButton = (track) => (canManage ? (
    savedIds.has(track.id) ? (
      <span className="spf-icon-btn spf-added" title="In the Song List"><i className="fas fa-circle-check"></i></span>
    ) : (
      <button type="button" className="spf-icon-btn spf-add" onClick={() => add(track)} disabled={busyId === track.id} aria-label={`Add ${track.title} to the Song List`} title="Add to Song List">
        <i className={`fas ${busyId === track.id ? 'fa-spinner fa-spin' : 'fa-plus'}`}></i>
      </button>
    )
  ) : null);

  return (
    <div className="spf-dash sp-scope">
      <div className="sp-player-card spf-player-card" ref={playerRef}>
        <div className="spf-stage-wrap">
          <VinylStage song={player.current} playing={embed.playing} />
          <span className="spf-pill"><i className="fab fa-spotify"></i> Spotify</span>
        </div>
        <PlayerControls
          player={player}
          emptySubtitle="Pick a song from the Song List"
          canStep={list.length > 0}
          shuffle={{ on: shuffle, toggle: () => setShuffle((v) => !v), disabled: list.length < 2 }}
        />
        {embed.failed
          ? <div className="spf-embed-host"><SpotifyEmbed trackId={playing?.id} compact /></div>
          : <div ref={embed.hostRef} className="spf-embed-host" hidden={!playing} />}
        <div className="spf-foot spf-player-foot"><SpotifyAttribution /></div>
      </div>

      {albumOf && (
        <AlbumPanel
          actorId={actorId}
          track={albumOf}
          playingId={playing?.id}
          onPlay={play}
          renderAction={addButton}
          onClose={() => setAlbumOf(null)}
        />
      )}

      <div className="sp-list-card">
        <div className="sp-list-head">
          <h3>
            <i className="fas fa-list-ul"></i>
            <span className="sp-list-head-name">Song List</span>
            <span className="sp-list-head-count">{saved?.length || 0}</span>
          </h3>
          {canManage && (
            <button type="button" className="sp-btn-primary sp-btn-sm" onClick={() => setShowFinder((v) => !v)}>
              <i className={`fas ${showFinder ? 'fa-chevron-up' : 'fa-plus'}`}></i> {showFinder ? 'Hide Spotify' : 'Add from Spotify'}
            </button>
          )}
        </div>
        {saved === null && <p className="spf-empty"><i className="fas fa-spinner fa-spin"></i> Loading the Song List...</p>}
        {error && <p className="spf-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}
        {saved && !error && saved.length === 0 && (
          <p className="spf-empty">{canManage ? 'No songs yet. Add Christian songs from the suggestions or search below.' : 'No songs in the Song List yet.'}</p>
        )}
        <ul className="sp-list">
          {list.map((track, i) => (
            <SongRow
              key={track.id}
              song={asSong(track)}
              index={i}
              player={player}
              actions={(
                <>
                  <a className="sp-icon-btn spf-open" href={track.url} target="_blank" rel="noreferrer" aria-label={`Open ${track.title} in Spotify`} title="Open in Spotify">
                    <i className="fab fa-spotify"></i>
                  </a>
                  {canManage && (
                    <button type="button" className="sp-icon-btn sp-row-delete" onClick={() => remove(track)} disabled={busyId === track.id} aria-label={`Remove ${track.title}`} title="Remove">
                      <i className={`fas ${busyId === track.id ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
                    </button>
                  )}
                </>
              )}
            />
          ))}
        </ul>
      </div>

      {(showFinder || (canManage && saved?.length === 0)) && (
        <div className="sp-list-card">
          <div className="sp-list-head">
            <h3><i className="fas fa-wand-magic-sparkles"></i> <span className="sp-list-head-name">Christian Song Suggestions</span></h3>
          </div>
          <SpotifyFinder actorId={actorId} renderAction={addButton} playingId={playing?.id} onPlay={play} onAlbum={setAlbumOf} />
        </div>
      )}
    </div>
  );
}

// The finder in a modal. `onPick(track)` gets the chosen song.
export function SpotifyPickerModal({ actorId, title = 'Find a song on Spotify', onPick, onClose }) {
  const [preview, setPreview] = useState(null);
  return createPortal(
    <div className="sp-modal-backdrop sp-scope" onClick={onClose}>
      <div className="sp-modal spf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sp-modal-head">
          <h3><i className="fab fa-spotify spf-brand"></i> {title}</h3>
          <button type="button" className="sp-icon-btn" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>
        {preview && <SpotifyEmbed trackId={preview.id} compact />}
        <SpotifyFinder
          actorId={actorId}
          playingId={preview?.id}
          onPlay={setPreview}
          renderAction={(track) => (
            <button type="button" className="sp-btn-primary sp-btn-sm spf-use" onClick={() => onPick(track)}>Use</button>
          )}
        />
      </div>
    </div>,
    document.body,
  );
}
