'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { daysWith, shortDay } from '@/lib/eventPublic';

// The photos attendees can open on the event's public page (after their
// password or RFID card). Files go from this browser straight to Cloudinary,
// signed by /api/events/photos - see src/lib/eventPhotos.js for why.
//
// A photo opens in the viewer below, on this page, never on Cloudinary. A
// Super Admin also sees each photo's hearts and can select photos to delete
// many at once. Pager is the host page's TablePager, passed in rather than
// imported (as EventAttendanceTab does); without it every photo shows at once.

// Cloudinary's free plan refuses an image over 10 MB (a 400 from the upload),
// and a camera photo is often more. Each photo is kept at up to 6000px - the
// frame's size, so framed downloads stay full resolution - and re-encoded as
// JPEG until it fits. A file the browser cannot open (HEIC on Chrome) goes up
// as it is.
const MAX_SIDE = 6000;
const MAX_BYTES = 9.5 * 1024 * 1024;

// Photos per bulk-delete request - the API's own limit (BULK_MAX there).
const DELETE_BATCH = 25;

async function shrink(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_BYTES && file.type === 'image/jpeg') { bitmap.close?.(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // PNGs with transparency: white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const q of [0.92, 0.85, 0.75, 0.65]) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
    if (blob && (blob.size <= MAX_BYTES || q === 0.65)) {
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
  }
  return file;
}

// Full-screen look at one photo, with the photos either side of it a click,
// an arrow key or a swipe away. Shows the framed preview attendees see.
function PhotoViewer({ list, index, onGo, onClose, onDelete, showHearts, dayLabel, canDelete }) {
  const p = list[index];
  // Which photo has finished loading, or failed: kept by id, so moving to
  // the next photo shows the spinner again without resetting anything.
  const [loadedId, setLoadedId] = useState(null);
  const [failedId, setFailedId] = useState(null);
  const touchX = useRef(null);
  const closeRef = useRef(null);
  const hasPrev = index > 0;
  const hasNext = index < list.length - 1;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onGo(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onGo(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onGo, onClose]);

  // The page behind stays put while the viewer is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = before; };
  }, []);

  // The photos either side are fetched now, so the next arrow is instant.
  useEffect(() => {
    [list[index - 1], list[index + 1]].forEach((n) => { if (n?.full) new Image().src = n.full; });
  }, [list, index]);

  if (!p) return null;
  const loaded = loadedId === p.id;
  const failed = failedId === p.id;

  return createPortal(
    <div className="evt-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div className="evt-viewer-top">
        <span className="evt-viewer-count">{index + 1} / {list.length}</span>
        {dayLabel && <span className="evt-viewer-chip">{dayLabel}</span>}
        {showHearts && (
          <span className={`evt-viewer-chip hearts ${p.hearts ? '' : 'none'}`} title="Hearts from attendees">
            <i className="fas fa-heart"></i> {p.hearts || 0} heart{p.hearts === 1 ? '' : 's'}
          </span>
        )}
        <span className="evt-viewer-gap" />
        {canDelete && (
          <button type="button" className="evt-viewer-btn danger" onClick={() => onDelete(p)} title="Delete photo">
            <i className="fas fa-trash"></i>
          </button>
        )}
        <button ref={closeRef} type="button" className="evt-viewer-btn" onClick={onClose} title="Close (Esc)">
          <i className="fas fa-xmark"></i>
        </button>
      </div>
      <div
        className="evt-viewer-stage"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (dx > 50 && hasPrev) onGo(index - 1);
          else if (dx < -50 && hasNext) onGo(index + 1);
        }}
      >
        {!loaded && !failed && <i className="fas fa-spinner fa-spin evt-viewer-wait"></i>}
        {failed ? (
          <p className="evt-viewer-fail"><i className="fas fa-image"></i> This photo could not be loaded.</p>
        ) : (
          <img
            key={p.id}
            src={p.full}
            alt=""
            className={loaded ? 'on' : ''}
            onLoad={() => setLoadedId(p.id)}
            onError={() => setFailedId(p.id)}
          />
        )}
        <button type="button" className="evt-viewer-nav prev" onClick={() => onGo(index - 1)} disabled={!hasPrev} title="Previous (Left arrow)">
          <i className="fas fa-chevron-left"></i>
        </button>
        <button type="button" className="evt-viewer-nav next" onClick={() => onGo(index + 1)} disabled={!hasNext} title="Next (Right arrow)">
          <i className="fas fa-chevron-right"></i>
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default function EventPhotosTab({ event, actorId, publicUrl, showToast, askConfirm = null, isSuperAdmin = false, Pager = null }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [progress, setProgress] = useState(null); // { done, total }
  const [needsDays, setNeedsDays] = useState(false);
  const [heartsReady, setHeartsReady] = useState(false);
  // 'all', or a day ('2026-10-02'). Also where new uploads go.
  const [day, setDay] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // The id of the photo open in the viewer.
  const [viewing, setViewing] = useState(null);
  // Super Admin: picking photos to delete together.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(null); // { done, total }
  const lastPick = useRef(null);
  const fileRef = useRef(null);

  const days = useMemo(() => daysWith(event, photos.map((p) => p.day_date)), [event, photos]);
  const multiDay = days.length > 1;
  const dayNo = (d) => days.indexOf(d) + 1;
  // A one-day event puts everything on its only day without asking.
  const uploadDay = day !== 'all' ? day : (days.length === 1 ? days[0] : null);
  const shown = useMemo(() => (day === 'all' ? photos : photos.filter((p) => p.day_date === day)), [photos, day]);
  const unsorted = photos.filter((p) => !p.day_date).length;
  const showHearts = isSuperAdmin && heartsReady;
  const totalHearts = photos.reduce((n, p) => n + (p.hearts || 0), 0);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages);
  const paged = Pager ? shown.slice((current - 1) * pageSize, current * pageSize) : shown;
  const pageAllPicked = paged.length > 0 && paged.every((p) => selected.has(p.id));

  const viewIndex = viewing ? shown.findIndex((p) => p.id === viewing) : -1;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/photos?eventId=${encodeURIComponent(event.id)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setPhotos(data.data || []);
      setNeedsDays(!!data.needsDays);
      setHeartsReady(!!data.heartsReady);
      setLoadError('');
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  // The host page's confirm dialog when there is one, the browser's if not.
  const confirmThen = (message, run, opts) => {
    if (askConfirm) askConfirm(message, run, opts);
    else if (window.confirm(message)) run();
  };

  const pickDay = (d) => {
    setDay(d);
    setPage(1);
    setSelected(new Set());
  };

  const upload = async (fileList) => {
    const files = [...(fileList || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    let failed = 0;
    let lastError = '';
    try {
      const signRes = await fetch('/api/events/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', eventId: event.id, actorId }),
      });
      const sign = await signRes.json();
      if (!sign.success) throw new Error(sign.message);
      const { uploadUrl, fields } = sign.data;

      // Three at a time: fast on a good connection, and a phone on event wifi
      // does not drop everything when one upload stalls.
      const queue = [...files];
      const uploaded = [];
      const worker = async () => {
        while (queue.length) {
          const file = queue.shift();
          try {
            const form = new FormData();
            Object.entries(fields).forEach(([k, v]) => form.append(k, v));
            form.append('file', await shrink(file));
            const res = await fetch(uploadUrl, { method: 'POST', body: form });
            const json = await res.json();
            if (!res.ok || !json.public_id) throw new Error(json?.error?.message || 'Upload failed');
            uploaded.push(json);
          } catch (e) {
            failed += 1;
            lastError = e.message;
          }
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      };
      await Promise.all([worker(), worker(), worker()]);

      if (uploaded.length) {
        const saveRes = await fetch('/api/events/photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', eventId: event.id, actorId, photos: uploaded, dayDate: needsDays ? null : uploadDay }),
        });
        const saved = await saveRes.json();
        if (!saved.success) throw new Error(saved.message);
        setPhotos((prev) => [...(saved.data || []).map((p) => ({ ...p, hearts: 0 })), ...prev]);
      }
      showToast?.(
        failed ? `${uploaded.length} uploaded, ${failed} failed${lastError ? ` - ${lastError}` : ''}` : `${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} uploaded`,
        failed ? 'warning' : 'success',
      );
    } catch (e) {
      showToast?.(e.message, 'danger');
    } finally {
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = (p) => confirmThen('Delete this photo? Attendees will no longer see it.', async () => {
    try {
      const res = await fetch(`/api/events/photos?id=${encodeURIComponent(p.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      // Deleted from the viewer: it moves on to the next photo (or the one
      // before, at the end) rather than closing.
      if (viewing === p.id) {
        const i = shown.findIndex((x) => x.id === p.id);
        setViewing((shown[i + 1] || shown[i - 1])?.id || null);
      }
      setPhotos((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      showToast?.(e.message, 'danger');
    }
  }, { title: 'Delete Photo', confirmLabel: 'Delete' });

  // Click picks one; Shift+click picks everything from the last one picked.
  const togglePick = (p, range) => {
    const anchor = range ? lastPick.current : null;
    lastPick.current = p.id;
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(p.id);
      const from = anchor ? shown.findIndex((x) => x.id === anchor) : -1;
      const to = shown.findIndex((x) => x.id === p.id);
      const span = from >= 0 && to >= 0 ? shown.slice(Math.min(from, to), Math.max(from, to) + 1) : [p];
      span.forEach((x) => (on ? next.add(x.id) : next.delete(x.id)));
      return next;
    });
  };

  const pickPage = () => setSelected((prev) => {
    const next = new Set(prev);
    paged.forEach((p) => (pageAllPicked ? next.delete(p.id) : next.add(p.id)));
    return next;
  });

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    lastPick.current = null;
  };

  // In batches, each one taken off the grid as it goes, so a long delete
  // shows its progress and a failure part-way keeps what already went.
  const removeMany = async () => {
    const ids = [...selected];
    const total = ids.length;
    let done = 0;
    let failMsg = '';
    setDeleting({ done, total });
    for (let i = 0; i < ids.length; i += DELETE_BATCH) {
      const batch = ids.slice(i, i + DELETE_BATCH);
      try {
        const res = await fetch('/api/events/photos', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch, actorId }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const gone = new Set(data.deleted || batch);
        setPhotos((prev) => prev.filter((x) => !gone.has(x.id)));
        setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
        done += gone.size;
        setDeleting({ done, total });
      } catch (e) {
        failMsg = e.message;
        break;
      }
    }
    setDeleting(null);
    if (failMsg) {
      showToast?.(`${done} of ${total} deleted - ${failMsg}`, 'danger');
    } else {
      showToast?.(`${done} photo${done === 1 ? '' : 's'} deleted`, 'success');
      stopSelecting();
    }
  };

  const askRemoveMany = () => {
    const n = selected.size;
    if (!n) return;
    confirmThen(
      `Delete ${n} photo${n === 1 ? '' : 's'}? Attendees will no longer see ${n === 1 ? 'it' : 'them'}, and this cannot be undone.`,
      removeMany,
      { title: 'Delete Photos', confirmLabel: `Delete ${n}` },
    );
  };

  const moveTo = async (p, dayDate) => {
    const before = p.day_date || null;
    setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, day_date: dayDate } : x)));
    try {
      const res = await fetch('/api/events/photos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [p.id], dayDate, actorId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
    } catch (e) {
      setPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, day_date: before } : x)));
      showToast?.(e.message, 'danger');
    }
  };

  const goTo = useCallback((i) => setViewing(shown[i]?.id || null), [shown]);
  // Closing lands the grid on the page of the photo last looked at.
  const closeViewer = useCallback(() => {
    if (viewIndex >= 0) setPage(Math.floor(viewIndex / pageSize) + 1);
    setViewing(null);
  }, [viewIndex, pageSize]);

  const busy = !!progress || !!deleting;

  return (
    <div className="evt-prog">
      <div className="evt-prog-bar">
        <div>
          <h4>
            Event Photos {photos.length > 0 && <span className="evt-tab-count">{photos.length}</span>}
            {showHearts && photos.length > 0 && (
              <span className="evt-photo-hearts-total" title="Hearts on every photo of this event">
                <i className="fas fa-heart"></i> {totalHearts}
              </span>
            )}
          </h4>
          <p>Attendees open these on the public page with their password (LASTNAME@YEAR) or their RFID card, and can download them.</p>
        </div>
        <div className="evt-prog-bar-actions">
          {publicUrl && (
            <a className="btn-secondary" href={`${publicUrl}/photos`} target="_blank" rel="noreferrer">
              <i className="fas fa-arrow-up-right-from-square"></i> Public Photos
            </a>
          )}
          {isSuperAdmin && photos.length > 0 && !selecting && (
            <button type="button" className="btn-secondary" onClick={() => setSelecting(true)} disabled={busy}>
              <i className="far fa-square-check"></i> Select
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <i className={`fas ${progress ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`}></i>
            {progress ? ` Uploading ${progress.done}/${progress.total}` : ' Upload Photos'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        </div>
      </div>

      {needsDays && multiDay && (
        <p className="evt-call-warn">
          <i className="fas fa-circle-info"></i> To sort photos by day, run supabase/migrations/event_photo_days.sql in the Supabase SQL editor.
        </p>
      )}

      {multiDay && !needsDays && (
        <div className="evt-daytabs" role="tablist" aria-label="Photos by day">
          <button type="button" role="tab" aria-selected={day === 'all'} className={day === 'all' ? 'active' : ''} onClick={() => pickDay('all')}>
            All <em>{photos.length}</em>
          </button>
          {days.map((d, i) => (
            <button key={d} type="button" role="tab" aria-selected={day === d} className={day === d ? 'active' : ''} onClick={() => pickDay(d)}>
              Day {i + 1} <small>{shortDay(d)}</small> <em>{photos.filter((p) => p.day_date === d).length}</em>
            </button>
          ))}
          <span className="evt-daytabs-hint">
            {day === 'all'
              ? <><i className="fas fa-circle-info"></i> Pick a day first so uploads go on that day{unsorted ? ` · ${unsorted} not on a day yet` : ''}</>
              : <><i className="fas fa-cloud-arrow-up"></i> Uploads go to Day {dayNo(day)}</>}
          </span>
        </div>
      )}

      {selecting && (
        <div className="evt-photo-tools">
          <strong>{selected.size} selected</strong>
          <button type="button" onClick={pickPage} disabled={!!deleting}>
            <i className={`far ${pageAllPicked ? 'fa-square-minus' : 'fa-square-check'}`}></i>
            {pageAllPicked ? ' Unselect page' : ` Select page (${paged.length})`}
          </button>
          {shown.length > paged.length && (
            <button type="button" onClick={() => setSelected(new Set(shown.map((p) => p.id)))} disabled={!!deleting}>
              Select all {shown.length}
            </button>
          )}
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())} disabled={!!deleting}>Clear</button>
          )}
          <span className="evt-photo-tools-hint">Shift+click picks a range</span>
          <span className="evt-photo-tools-gap" />
          <button type="button" className="danger" onClick={askRemoveMany} disabled={!selected.size || busy}>
            <i className={`fas ${deleting ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
            {deleting ? ` Deleting ${deleting.done}/${deleting.total}` : ` Delete${selected.size ? ` ${selected.size}` : ''}`}
          </button>
          <button type="button" onClick={stopSelecting} disabled={!!deleting}>Done</button>
        </div>
      )}

      <div
        className={`evt-photos-drop ${busy ? 'busy' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!busy) upload(e.dataTransfer.files); }}
      >
        {loading ? (
          <p className="evt-prog-empty"><i className="fas fa-spinner fa-spin"></i> Loading photos…</p>
        ) : loadError ? (
          <p className="evt-field-error-msg">{loadError}</p>
        ) : shown.length === 0 ? (
          <div className="evt-prog-empty">
            <i className="fas fa-images"></i>
            <p>{day === 'all' ? 'No photos yet.' : `No Day ${dayNo(day)} photos yet.`} Drop photos here or press Upload Photos.</p>
          </div>
        ) : (
          <div className={`evt-photos-grid ${selecting ? 'picking' : ''}`}>
            {paged.map((p) => {
              const picked = selected.has(p.id);
              return (
                <figure key={p.id} className={picked ? 'picked' : ''}>
                  <button
                    type="button"
                    className="evt-photo-open"
                    onClick={(e) => (selecting ? togglePick(p, e.shiftKey) : setViewing(p.id))}
                    aria-pressed={selecting ? picked : undefined}
                    aria-label={selecting ? (picked ? 'Unselect photo' : 'Select photo') : 'View photo'}
                  >
                    <img src={p.thumb} alt="" loading="lazy" />
                  </button>
                  {selecting ? (
                    <span className="evt-photo-check" aria-hidden="true"><i className="fas fa-check"></i></span>
                  ) : (
                    <button type="button" className="evt-photo-del" onClick={() => remove(p)} title="Delete photo"><i className="fas fa-trash"></i></button>
                  )}
                  {showHearts && (
                    <span className={`evt-photo-hearts ${p.hearts ? '' : 'none'}`} title={`${p.hearts || 0} heart${p.hearts === 1 ? '' : 's'}`}>
                      <i className="fas fa-heart"></i> {p.hearts || 0}
                    </span>
                  )}
                  {multiDay && !needsDays && (
                    <select
                      className="evt-photo-day"
                      value={p.day_date || ''}
                      onChange={(e) => moveTo(p, e.target.value || null)}
                      title="Which day this photo is from"
                    >
                      <option value="">No day</option>
                      {days.map((d, i) => <option key={d} value={d}>Day {i + 1}</option>)}
                    </select>
                  )}
                </figure>
              );
            })}
          </div>
        )}
      </div>

      {Pager && shown.length > 10 && (
        <Pager
          page={current}
          pageSize={pageSize}
          total={shown.length}
          onPage={setPage}
          onSize={(n) => { setPageSize(n); setPage(1); }}
          label="photos"
        />
      )}

      {viewIndex >= 0 && (
        <PhotoViewer
          list={shown}
          index={viewIndex}
          onGo={goTo}
          onClose={closeViewer}
          onDelete={remove}
          showHearts={showHearts}
          dayLabel={multiDay && shown[viewIndex].day_date ? `Day ${dayNo(shown[viewIndex].day_date)}` : ''}
          canDelete={!busy}
        />
      )}
    </div>
  );
}
