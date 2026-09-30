'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { pruneSongCache } from '@/lib/songCache';
import { useSongPlayer } from './songPlayer/useSongPlayer';
import { PlayerControls, SongRow, VinylStage } from './songPlayer/PlayerParts';
import './SongPlaylist.css';

// Worship & Schedule > Song Playlist. The player itself (engine, record,
// controls) is shared with the event page: see ./songPlayer.
//
// Songs are grouped by artist: an artist has a name and a cover, and every
// song under it uses that cover.

const COVER_SIZE = 1080;
const MAX_AUDIO_MB = 50;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|oga|flac)$/i;

function shuffled(ids, firstId) {
  const rest = ids.filter((id) => id !== firstId);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return firstId ? [firstId, ...rest] : rest;
}

// Center-crops the picked image to a 1080x1080 square. Refuses anything
// smaller: an upscaled cover is exactly the blurry result we are avoiding.
function loadCover(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (side < COVER_SIZE) {
        URL.revokeObjectURL(url);
        reject(new Error(`The cover must be at least ${COVER_SIZE}x${COVER_SIZE}. This one is ${img.naturalWidth}x${img.naturalHeight}.`));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = COVER_SIZE;
      canvas.height = COVER_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, COVER_SIZE, COVER_SIZE);
      URL.revokeObjectURL(url);
      // WebP where the browser can encode it; Cloudinary converts anything
      // else to WebP on the way in regardless.
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not read that image.')); return; }
        resolve({ blob, preview: URL.createObjectURL(blob), cropped: img.naturalWidth !== img.naturalHeight });
      }, 'image/webp', 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

async function uploadToCloudinary({ actorId, kind, file, fileName, onProgress }) {
  const res = await fetch('/api/song-playlist/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, kind, fileName }),
  });
  const signed = await res.json();
  if (!signed.success) throw new Error(signed.message || 'Could not start the upload.');

  const form = new FormData();
  Object.entries(signed.fields).forEach(([k, v]) => form.append(k, String(v)));
  form.append('file', file, fileName);

  // XHR rather than fetch, for the progress bar on a large song.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', signed.uploadUrl);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let json = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300 && json.secure_url) resolve(json);
      else reject(new Error(json?.error?.message || 'Cloudinary upload failed.'));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading.'));
    xhr.send(form);
  });
}

function CoverPicker({ cover, existingUrl, disabled, onPick }) {
  const shown = cover?.preview || existingUrl;
  return (
    <>
      <label className={`sp-cover-drop ${shown ? 'has-cover' : ''}`}>
        <input type="file" accept="image/*" hidden disabled={disabled} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
        {shown ? (
          <>
            <img src={shown} alt="Cover preview" />
            <span className="sp-cover-drop-change"><i className="fas fa-camera"></i> Change</span>
          </>
        ) : (
          <span className="sp-cover-drop-hint">
            <i className="fas fa-image"></i>
            <strong>Add Artist Cover</strong>
            <small>1080 x 1080 or larger &middot; saved as WebP</small>
          </span>
        )}
      </label>
      {cover?.cropped && <p className="sp-note"><i className="fas fa-crop-simple"></i> Not square, so it was center-cropped to 1080x1080.</p>}
    </>
  );
}

// Add an artist, or (with `artist`) rename one / replace its cover.
function ArtistModal({ actorId, artist, onClose, onSaved }) {
  const editing = !!artist;
  const [name, setName] = useState(artist?.name || '');
  const [cover, setCover] = useState(null); // { blob, preview, cropped }
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => () => { if (cover?.preview) URL.revokeObjectURL(cover.preview); }, [cover]);

  const pickCover = async (file) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('The cover must be an image.'); return; }
    try { setCover(await loadCover(file)); } catch (e) { setCover(null); setError(e.message); }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Artist name is required.'); return; }
    if (!editing && !cover) { setError('Add a 1080x1080 cover for the artist.'); return; }
    setSaving(true);
    setError('');
    try {
      let coverPayload;
      if (cover) {
        setProgress('Uploading cover...');
        const res = await uploadToCloudinary({ actorId, kind: 'cover', file: cover.blob, fileName: `${name.trim()}.webp` });
        coverPayload = { publicId: res.public_id, url: res.secure_url };
      }
      setProgress('Saving...');
      const res = await fetch('/api/song-playlist/artists', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, id: artist?.id, name, cover: coverPayload }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Could not save the artist.');
      onSaved(json.data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setProgress('');
    }
  };

  return createPortal(
    <div className="sp-modal-backdrop" onClick={() => !saving && onClose()}>
      <form className="sp-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sp-modal-head">
          <h3><i className="fas fa-microphone-lines"></i> {editing ? 'Edit Artist' : 'Add Artist'}</h3>
          <button type="button" className="sp-icon-btn" onClick={onClose} disabled={saving} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>

        <CoverPicker cover={cover} existingUrl={artist?.cover_tile_url} disabled={saving} onPick={pickCover} />
        <p className="sp-note">Every song under this artist uses this cover.</p>

        <label className="sp-field">
          <span>Artist Name</span>
          <input type="text" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} placeholder="Chris Tomlin" disabled={saving} />
        </label>

        {error && <p className="sp-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}

        <div className="sp-modal-actions">
          <button type="button" className="sp-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="sp-btn-primary" disabled={saving}>
            {saving
              ? <><i className="fas fa-spinner fa-spin"></i> {progress}</>
              : <><i className={`fas ${editing ? 'fa-check' : 'fa-plus'}`}></i> {editing ? 'Save' : 'Add Artist'}</>}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

// A song under an artist: just the title and the audio - the cover is the artist's.
function AddSongModal({ actorId, artists, defaultArtistId, onClose, onAdded }) {
  const [artistId, setArtistId] = useState(defaultArtistId || artists[0]?.id || '');
  const [title, setTitle] = useState('');
  const [audio, setAudio] = useState(null); // File
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState('');
  const artist = artists.find((a) => a.id === artistId) || null;

  const pickAudio = (file) => {
    setError('');
    if (!file) return;
    // Some browsers report no type for .mp3, so the extension counts too.
    if (!file.type.startsWith('audio/') && !AUDIO_EXT.test(file.name)) { setError('Pick an audio file (MP3, M4A, WAV...).'); return; }
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) { setError(`The audio must be under ${MAX_AUDIO_MB} MB.`); return; }
    setAudio(file);
    // A title from the file name, if none was typed yet.
    if (!title.trim()) setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim());
  };

  const save = async (e) => {
    e.preventDefault();
    if (!artist) { setError('Choose the artist.'); return; }
    if (!title.trim()) { setError('Song title is required.'); return; }
    if (!audio) { setError('Add the song audio file.'); return; }
    setSaving(true);
    setError('');
    try {
      const audioRes = await uploadToCloudinary({
        actorId,
        kind: 'audio',
        file: audio,
        fileName: audio.name,
        onProgress: (p) => setProgress(`Uploading song... ${Math.round(p * 100)}%`),
      });
      setProgress('Saving...');
      const res = await fetch('/api/song-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId,
          artistId: artist.id,
          title,
          audio: { publicId: audioRes.public_id, url: audioRes.secure_url, duration: audioRes.duration },
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Could not save the song.');
      onAdded(json.data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setProgress('');
    }
  };

  return createPortal(
    <div className="sp-modal-backdrop" onClick={() => !saving && onClose()}>
      <form className="sp-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="sp-modal-head">
          <h3><i className="fas fa-compact-disc"></i> Add Song</h3>
          <button type="button" className="sp-icon-btn" onClick={onClose} disabled={saving} aria-label="Close"><i className="fas fa-times"></i></button>
        </div>

        <label className="sp-field">
          <span>Artist</span>
          <span className="sp-artist-pick">
            {artist && <img src={artist.cover_thumb_url || artist.cover_url} alt="" />}
            <select value={artistId} onChange={(e) => setArtistId(e.target.value)} disabled={saving}>
              {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </span>
          <small className="sp-field-hint">The song uses this artist&apos;s cover.</small>
        </label>

        <label className="sp-field">
          <span>Song Title</span>
          <input type="text" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} placeholder="How Great Is Our God" disabled={saving} />
        </label>
        <label className="sp-field">
          <span>Song Audio</span>
          <span className="sp-audio-pick">
            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac" hidden disabled={saving} onChange={(e) => { pickAudio(e.target.files?.[0]); e.target.value = ''; }} />
            <i className="fas fa-music"></i>
            <span>{audio ? audio.name : `Choose MP3 / audio file (max ${MAX_AUDIO_MB} MB)`}</span>
          </span>
        </label>

        {error && <p className="sp-error"><i className="fas fa-circle-exclamation"></i> {error}</p>}

        <div className="sp-modal-actions">
          <button type="button" className="sp-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="sp-btn-primary" disabled={saving}>
            {saving ? <><i className="fas fa-spinner fa-spin"></i> {progress}</> : <><i className="fas fa-plus"></i> Add Song</>}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export default function SongPlaylist({ actorId, canManage }) {
  const [artists, setArtists] = useState([]);
  const [songs, setSongs] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' or an artist id
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [order, setOrder] = useState([]);
  const [artistModal, setArtistModal] = useState(null); // null | { artist? }
  const [songModal, setSongModal] = useState(null);     // null | { artistId }
  const [deletingId, setDeletingId] = useState(null);

  const player = useSongPlayer({ songs, order });
  const { current, currentId, setCurrentId, playing } = player;
  const selectedArtist = filter === 'all' ? null : artists.find((a) => a.id === filter) || null;

  // The songs grouped by artist, A to Z; songs within an artist in the order
  // they were added. Songs with no artist (should not happen after the
  // migration) go last.
  const groups = useMemo(() => {
    const byArtist = artists
      .map((artist) => ({ artist, songs: songs.filter((s) => s.artist_id === artist.id) }));
    const orphans = songs.filter((s) => !artists.some((a) => a.id === s.artist_id));
    if (orphans.length) byArtist.push({ artist: null, songs: orphans });
    return byArtist;
  }, [artists, songs]);

  // What the list shows, and so what next/previous/shuffle move through.
  const visibleGroups = filter === 'all' ? groups.filter((g) => g.songs.length) : groups.filter((g) => g.artist?.id === filter);
  const visibleIds = visibleGroups.flatMap((g) => g.songs.map((s) => s.id));
  const visibleKey = visibleIds.join(',');

  const reload = async () => {
    try {
      const [artistsRes, songsRes] = await Promise.all([
        fetch('/api/song-playlist/artists').then((r) => r.json()),
        fetch('/api/song-playlist').then((r) => r.json()),
      ]);
      if (!artistsRes.success) throw new Error(artistsRes.message);
      if (!songsRes.success) throw new Error(songsRes.message);
      setLoadError('');
      setArtists(artistsRes.data);
      setSongs(songsRes.data);
      setCurrentId((id) => (songsRes.data.some((s) => s.id === id) ? id : songsRes.data[0]?.id || null));
      player.refreshCached();
      pruneSongCache(songsRes.data.map((s) => s.stream_url));
    } catch (e) {
      setLoadError(e.message || 'Could not load the playlist.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The play order: the list as shown, or a shuffle of it that starts from
  // the song on the record. Rebuilt when the list changes or shuffle flips.
  useEffect(() => {
    const ids = visibleKey ? visibleKey.split(',') : [];
    setOrder(shuffle ? shuffled(ids, ids.includes(currentId) ? currentId : null) : ids);
    // currentId deliberately left out: changing song must not reshuffle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, shuffle]);

  const removeSong = async (song) => {
    if (!window.confirm(`Delete "${song.title}" from the playlist?`)) return;
    setDeletingId(song.id);
    try {
      const res = await fetch(`/api/song-playlist?id=${encodeURIComponent(song.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      player.release([song.id]);
      await reload();
    } catch (e) {
      window.alert(e.message || 'Could not delete the song.');
    } finally {
      setDeletingId(null);
    }
  };

  const removeArtist = async (artist) => {
    const count = songs.filter((s) => s.artist_id === artist.id).length;
    const what = count ? ` and its ${count} ${count === 1 ? 'song' : 'songs'}` : '';
    if (!window.confirm(`Delete ${artist.name}${what}? This cannot be undone.`)) return;
    setDeletingId(artist.id);
    try {
      const res = await fetch(`/api/song-playlist/artists?id=${encodeURIComponent(artist.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      player.release(songs.filter((s) => s.artist_id === artist.id).map((s) => s.id));
      setFilter('all');
      await reload();
    } catch (e) {
      window.alert(e.message || 'Could not delete the artist.');
    } finally {
      setDeletingId(null);
    }
  };

  const openAddSong = () => {
    if (!artists.length) { setArtistModal({}); return; }
    setSongModal({ artistId: selectedArtist?.id || (current?.artist_id) || artists[0].id });
  };

  const listTitle = selectedArtist ? selectedArtist.name : 'All Songs';
  const listCount = visibleIds.length;

  return (
    <div className="sp-page">
      <div className="sp-header">
        <div>
          <h2 className="section-title sp-title">Song Playlist</h2>
          <p className="sp-subtitle">
            {artists.length} {artists.length === 1 ? 'artist' : 'artists'} &middot; {songs.length} {songs.length === 1 ? 'song' : 'songs'}
          </p>
        </div>
        {canManage && (
          <button type="button" className="sp-btn-primary" onClick={() => setArtistModal({})}>
            <i className="fas fa-plus"></i> Add Artist
          </button>
        )}
      </div>

      <div className="sp-player-card">
        <VinylStage song={current} playing={playing} />
        <PlayerControls
          player={player}
          emptySubtitle={canManage ? 'Add an artist, then their songs' : 'No songs yet'}
          canStep={order.length > 0}
          shuffle={{ on: shuffle, toggle: () => setShuffle((v) => !v), disabled: listCount < 2 }}
        />
        <audio {...player.audioProps} />
      </div>

      {/* ---- Artists ---- */}
      {(artists.length > 0 || canManage) && !loadError && (
        <div className="sp-artists-card">
          <div className="sp-list-head">
            <h3><i className="fas fa-microphone-lines"></i> Artists</h3>
          </div>
          <div className="sp-artists" role="tablist" aria-label="Artists">
            <button type="button" role="tab" aria-selected={filter === 'all'} className={`sp-artist ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>
              <span className="sp-artist-cover sp-artist-all"><i className="fas fa-compact-disc"></i></span>
              <span className="sp-artist-name">All Songs</span>
              <span className="sp-artist-count">{songs.length} {songs.length === 1 ? 'song' : 'songs'}</span>
            </button>
            {artists.map((artist) => {
              const count = songs.filter((s) => s.artist_id === artist.id).length;
              const isPlayingHere = playing && current?.artist_id === artist.id;
              return (
                <button type="button" role="tab" key={artist.id} aria-selected={filter === artist.id} className={`sp-artist ${filter === artist.id ? 'is-active' : ''}`} onClick={() => setFilter(artist.id)}>
                  <span className="sp-artist-cover">
                    <img src={artist.cover_tile_url || artist.cover_url} alt="" loading="lazy" />
                    {isPlayingHere && <span className="sp-artist-live"><span className="sp-eq"><i /><i /><i /></span></span>}
                  </span>
                  <span className="sp-artist-name">{artist.name}</span>
                  <span className="sp-artist-count">{count} {count === 1 ? 'song' : 'songs'}</span>
                </button>
              );
            })}
            {canManage && (
              <button type="button" className="sp-artist sp-artist-add" onClick={() => setArtistModal({})}>
                <span className="sp-artist-cover"><i className="fas fa-plus"></i></span>
                <span className="sp-artist-name">Add Artist</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- Songs ---- */}
      <div className="sp-list-card">
        <div className="sp-list-head">
          <h3>
            {selectedArtist
              ? <img className="sp-list-head-cover" src={selectedArtist.cover_thumb_url || selectedArtist.cover_url} alt="" />
              : <i className="fas fa-list-ul"></i>}
            <span className="sp-list-head-name">{listTitle}</span>
            <span className="sp-list-head-count">{listCount}</span>
          </h3>
          <div className="sp-list-head-actions">
            {shuffle && <span className="sp-chip"><i className="fas fa-shuffle"></i> Shuffle</span>}
            {canManage && selectedArtist && (
              <>
                <button type="button" className="sp-icon-btn" onClick={() => setArtistModal({ artist: selectedArtist })} aria-label={`Edit ${selectedArtist.name}`} title="Edit artist">
                  <i className="fas fa-pen"></i>
                </button>
                <button type="button" className="sp-icon-btn sp-danger" onClick={() => removeArtist(selectedArtist)} disabled={deletingId === selectedArtist.id} aria-label={`Delete ${selectedArtist.name}`} title="Delete artist">
                  <i className={`fas ${deletingId === selectedArtist.id ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
                </button>
              </>
            )}
            {canManage && artists.length > 0 && (
              <button type="button" className="sp-btn-primary sp-btn-sm" onClick={openAddSong}>
                <i className="fas fa-plus"></i> Add Song
              </button>
            )}
          </div>
        </div>

        {loading && <div className="sp-empty"><i className="fas fa-spinner fa-spin"></i> Loading songs...</div>}
        {!loading && loadError && <div className="sp-empty sp-error">{loadError}</div>}
        {!loading && !loadError && artists.length === 0 && (
          <div className="sp-empty">
            <i className="fas fa-microphone-lines"></i>
            <p>No artists yet.</p>
            {canManage && <button type="button" className="sp-btn-primary" onClick={() => setArtistModal({})}><i className="fas fa-plus"></i> Add the first artist</button>}
          </div>
        )}
        {!loading && !loadError && artists.length > 0 && listCount === 0 && (
          <div className="sp-empty">
            <i className="fas fa-compact-disc"></i>
            <p>{selectedArtist ? `No songs for ${selectedArtist.name} yet.` : 'No songs yet.'}</p>
            {canManage && <button type="button" className="sp-btn-primary" onClick={openAddSong}><i className="fas fa-plus"></i> Add a song</button>}
          </div>
        )}

        {visibleGroups.map((group) => (
          <div className="sp-group" key={group.artist?.id || 'none'}>
            {filter === 'all' && (
              <button type="button" className="sp-group-head" onClick={() => group.artist && setFilter(group.artist.id)}>
                {group.artist && <img src={group.artist.cover_thumb_url || group.artist.cover_url} alt="" />}
                <span>{group.artist?.name || 'Other'}</span>
                <i className="fas fa-chevron-right"></i>
              </button>
            )}
            <ul className="sp-list">
              {group.songs.map((song, i) => (
                <SongRow
                  key={song.id}
                  song={song}
                  index={i}
                  player={player}
                  actions={canManage && (
                    <button type="button" className="sp-icon-btn sp-row-delete" onClick={() => removeSong(song)} disabled={deletingId === song.id} aria-label={`Delete ${song.title}`} title="Delete">
                      <i className={`fas ${deletingId === song.id ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
                    </button>
                  )}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {artistModal && (
        <ArtistModal
          actorId={actorId}
          artist={artistModal.artist}
          onClose={() => setArtistModal(null)}
          onSaved={async (artist) => {
            setArtistModal(null);
            await reload();
            setFilter(artist.id);
          }}
        />
      )}

      {songModal && (
        <AddSongModal
          actorId={actorId}
          artists={artists}
          defaultArtistId={songModal.artistId}
          onClose={() => setSongModal(null)}
          onAdded={async (song) => {
            setSongModal(null);
            await reload();
            setFilter(song.artist_id);
            setCurrentId((id) => id || song.id);
          }}
        />
      )}
    </div>
  );
}
