'use client';

import { formatTime } from './useSongPlayer';
import '../SongPlaylist.css';

// The pieces of the Song Playlist player shared by the dashboard and the
// event public page. Styles live in SongPlaylist.css; wrap them in an element
// with class `sp-scope` (or inside .sp-page) for the colour variables.

// The Figma "Vinyl" frame: the album sleeve with the record sliding out
// behind it, the song's cover on the record's label. The record spins while
// the music plays and holds its angle when paused.
export function VinylStage({ song, playing }) {
  return (
    <div className={`sp-stage ${playing ? 'is-playing' : ''}`}>
      <div className="sp-vinyl">
        <div className="sp-vinyl-disc">
          <img className="sp-vinyl-img" src="/Playlist/Vinyl.png" alt="" draggable={false} />
          {song && <img className="sp-vinyl-label" src={song.cover_label_url || song.cover_url} alt="" draggable={false} />}
          <span className="sp-vinyl-hole" />
        </div>
      </div>
      <div className="sp-sleeve">
        <div className="sp-sleeve-inner">
          {song ? (
            <>
              <img className="sp-sleeve-cover" src={song.cover_url} alt={`${song.title} cover`} draggable={false} />
              <div className="sp-sleeve-text">
                <div className="sp-sleeve-title">{song.title}</div>
                <div className="sp-sleeve-artist">{song.artist}</div>
              </div>
            </>
          ) : (
            <div className="sp-sleeve-empty"><i className="fas fa-compact-disc"></i><span>No song selected</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

// Now playing, seek bar, status line and the transport buttons.
// `shuffle` is optional: pass { on, toggle, disabled } to show the button.
export function PlayerControls({ player, emptyTitle = 'Nothing playing', emptySubtitle = '', canStep = true, shuffle }) {
  const { current, playing, time, duration, loadingPct, playError } = player;
  const progressPct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const busy = loadingPct !== null;
  const playLabel = busy ? 'Cancel' : playing ? 'Pause' : 'Play';

  return (
    <div className="sp-controls">
      <div className="sp-now">
        <div className="sp-now-title">{current?.title || emptyTitle}</div>
        <div className="sp-now-artist">{current?.artist || emptySubtitle}</div>
      </div>

      <div className="sp-progress">
        <span>{formatTime(time)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step="0.1"
          value={Math.min(time, duration || 0)}
          onChange={(e) => player.seek(Number(e.target.value))}
          disabled={!current || !duration}
          style={{ '--sp-pct': `${progressPct}%` }}
          aria-label="Seek"
        />
        <span>{formatTime(duration)}</span>
      </div>

      {(busy || playError) && (
        <p className={`sp-status ${playError ? 'is-error' : ''}`}>
          {playError || (loadingPct > 0
            ? `Loading song... ${Math.round(loadingPct * 100)}% - saved on this device after`
            : 'Loading song...')}
        </p>
      )}

      <div className="sp-buttons">
        {shuffle ? (
          <button type="button" className={`sp-ctrl ${shuffle.on ? 'is-on' : ''}`} onClick={shuffle.toggle} disabled={shuffle.disabled} aria-label="Shuffle" aria-pressed={shuffle.on} title="Shuffle">
            <i className="fas fa-shuffle"></i>
          </button>
        ) : <span className="sp-ctrl-spacer" aria-hidden="true" />}
        <button type="button" className="sp-ctrl" onClick={() => player.step(-1)} disabled={!canStep} aria-label="Previous" title="Previous">
          <i className="fas fa-backward-step"></i>
        </button>
        <button type="button" className="sp-ctrl sp-ctrl-play" onClick={player.togglePlay} disabled={!current} aria-label={playLabel} title={playLabel}>
          <i className={`fas ${busy ? 'fa-spinner fa-spin' : playing ? 'fa-pause' : 'fa-play'}`}></i>
        </button>
        <button type="button" className="sp-ctrl" onClick={() => player.step(1)} disabled={!canStep} aria-label="Next" title="Next">
          <i className="fas fa-forward-step"></i>
        </button>
        <span className="sp-ctrl-spacer" aria-hidden="true" />
      </div>
    </div>
  );
}

// One song in a list: number (or the equaliser while it plays), cover,
// title / artist, a "saved on this device" tick, length and play button.
// `actions` renders after the row (e.g. a delete button).
export function SongRow({ song, index, player, actions }) {
  const isCurrent = song.id === player.currentId;
  const isPlaying = isCurrent && player.playing;
  return (
    <li className={`sp-row ${isCurrent ? 'is-current' : ''}`}>
      <button type="button" className="sp-row-main" onClick={() => player.playSong(song.id)}>
        <span className="sp-row-num">
          {isPlaying ? <span className="sp-eq" aria-label="Playing"><i /><i /><i /></span> : index + 1}
        </span>
        <img className="sp-row-cover" src={song.cover_thumb_url || song.cover_url} alt="" loading="lazy" />
        <span className="sp-row-text">
          <span className="sp-row-title">{song.title}</span>
          <span className="sp-row-artist">{song.artist}</span>
        </span>
        {player.cachedUrls.has(song.stream_url) && (
          <span className="sp-row-saved" title="Saved on this device - replays use no data"><i className="fas fa-circle-check"></i></span>
        )}
        <span className="sp-row-time">{formatTime(Number(song.duration_seconds))}</span>
        <span className="sp-row-play"><i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i></span>
      </button>
      {actions}
    </li>
  );
}
