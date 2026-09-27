'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { daysWith, shortDay } from '@/lib/eventPublic';

// The photos attendees can open on the event's public page (after their
// password or RFID card). Files go from this browser straight to Cloudinary,
// signed by /api/events/photos - see src/lib/eventPhotos.js for why.

// Cloudinary's free plan refuses an image over 10 MB (a 400 from the upload),
// and a camera photo is often more. Each photo is kept at up to 6000px - the
// frame's size, so framed downloads stay full resolution - and re-encoded as
// JPEG until it fits. A file the browser cannot open (HEIC on Chrome) goes up
// as it is.
const MAX_SIDE = 6000;
const MAX_BYTES = 9.5 * 1024 * 1024;

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

export default function EventPhotosTab({ event, actorId, publicUrl, showToast }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [progress, setProgress] = useState(null); // { done, total }
  const [needsDays, setNeedsDays] = useState(false);
  // 'all', or a day ('2026-10-02'). Also where new uploads go.
  const [day, setDay] = useState('all');
  const fileRef = useRef(null);

  const days = useMemo(() => daysWith(event, photos.map((p) => p.day_date)), [event, photos]);
  const multiDay = days.length > 1;
  const dayNo = (d) => days.indexOf(d) + 1;
  // A one-day event puts everything on its only day without asking.
  const uploadDay = day !== 'all' ? day : (days.length === 1 ? days[0] : null);
  const shown = day === 'all' ? photos : photos.filter((p) => p.day_date === day);
  const unsorted = photos.filter((p) => !p.day_date).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/events/photos?eventId=${encodeURIComponent(event.id)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setPhotos(data.data || []);
      setNeedsDays(!!data.needsDays);
      setLoadError('');
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

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
        setPhotos((prev) => [...(saved.data || []), ...prev]);
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

  const remove = async (p) => {
    if (!window.confirm('Delete this photo? Attendees will no longer see it.')) return;
    try {
      const res = await fetch(`/api/events/photos?id=${encodeURIComponent(p.id)}&actorId=${encodeURIComponent(actorId || '')}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setPhotos((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      showToast?.(e.message, 'danger');
    }
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

  const busy = !!progress;

  return (
    <div className="evt-prog">
      <div className="evt-prog-bar">
        <div>
          <h4>Event Photos {photos.length > 0 && <span className="evt-tab-count">{photos.length}</span>}</h4>
          <p>Attendees open these on the public page with their password (LASTNAME@YEAR) or their RFID card, and can download them.</p>
        </div>
        <div className="evt-prog-bar-actions">
          {publicUrl && (
            <a className="btn-secondary" href={`${publicUrl}/photos`} target="_blank" rel="noreferrer">
              <i className="fas fa-arrow-up-right-from-square"></i> Public Photos
            </a>
          )}
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`}></i>
            {busy ? ` Uploading ${progress.done}/${progress.total}` : ' Upload Photos'}
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
          <button type="button" role="tab" aria-selected={day === 'all'} className={day === 'all' ? 'active' : ''} onClick={() => setDay('all')}>
            All <em>{photos.length}</em>
          </button>
          {days.map((d, i) => (
            <button key={d} type="button" role="tab" aria-selected={day === d} className={day === d ? 'active' : ''} onClick={() => setDay(d)}>
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
          <div className="evt-photos-grid">
            {shown.map((p) => (
              <figure key={p.id}>
                <a href={p.full} target="_blank" rel="noreferrer"><img src={p.thumb} alt="" loading="lazy" /></a>
                <button type="button" onClick={() => remove(p)} title="Delete photo"><i className="fas fa-trash"></i></button>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
