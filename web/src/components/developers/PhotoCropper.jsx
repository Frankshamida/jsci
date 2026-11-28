'use client';

// Cropping a developer's photo to exactly the card's frame (7:10), so what
// the admin sees here is what the website shows. The bottom 30% is shaded:
// the glass name panel covers it. Beside it, the finished card, live.
// "Use this photo" makes a 700 x 1000 WebP in the browser (about 300 KB).

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { DEV_PHOTO } from '@/lib/developers';
import { DeveloperCard } from './DeveloperWelcome';

const Cropper = dynamic(() => import('react-easy-crop'), { ssr: false });
const TARGET_BYTES = 300 * 1024;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be opened. Try another file.'));
    img.src = src;
  });
}
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * The cropped part of `src` (pixels of the original) drawn at width x height.
 * WebP where the browser can write it (smaller until about 300 KB), else JPEG.
 */
export async function cropToBlob(src, px, { width = DEV_PHOTO.width, height = DEV_PHOTO.height } = {}) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, px.x, px.y, px.width, px.height, 0, 0, width, height);
  let last = null;
  for (const q of [0.85, 0.78, 0.7, 0.62]) {
    // eslint-disable-next-line no-await-in-loop
    const blob = await toBlob(canvas, 'image/webp', q);
    if (!blob || blob.type !== 'image/webp') { last = null; break; } // this browser cannot write WebP
    last = blob;
    if (blob.size <= TARGET_BYTES) return blob;
  }
  if (last) return last;
  // JPEG has no transparency: put the picture on white first.
  const flat = document.createElement('canvas');
  flat.width = width;
  flat.height = height;
  const fctx = flat.getContext('2d');
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, width, height);
  fctx.drawImage(canvas, 0, 0);
  const jpeg = await toBlob(flat, 'image/jpeg', 0.85);
  if (!jpeg) throw new Error('This browser could not prepare the photo. Try another browser.');
  return jpeg;
}

/**
 * @param {string}   src       the picked image (an object URL)
 * @param {object}   dev       the developer, for the card preview
 * @param {Function} onCancel
 * @param {Function} onDone    ({ blob, url, lowRes }) with the 700 x 1000 image
 */
export default function PhotoCropper({ src, dev, onCancel, onDone }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState(null); // pixels of the original
  const [frame, setFrame] = useState(null); // the crop frame on screen
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const previewUrl = useRef(null);

  // The small card beside the cropper, redrawn a moment after each move.
  useEffect(() => {
    if (!area) return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const blob = await cropToBlob(src, area, { width: 210, height: 300 });
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url;
        setPreview(url);
      } catch { /* the big picture is still there to crop */ }
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [src, area]);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  const lowRes = !!area && (area.width < DEV_PHOTO.minWidth || area.height < DEV_PHOTO.minHeight);

  const use = async () => {
    if (!area) return;
    setBusy(true);
    setError('');
    try {
      const blob = await cropToBlob(src, area);
      onDone({ blob, url: URL.createObjectURL(blob), lowRes });
    } catch (e) {
      setError(e.message || 'The photo could not be prepared. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="dvm-crop">
      <div className="dvm-crop-main">
        <div className="dvm-crop-stage">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            minZoom={1}
            maxZoom={4}
            aspect={DEV_PHOTO.aspect}
            objectFit="vertical-cover"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, px) => setArea(px)}
            onCropSizeChange={setFrame}
          />
          {frame && (
            <div className="dvm-crop-guide" style={{ width: frame.width, height: frame.height }} aria-hidden="true">
              <span className="dvm-crop-face">Face here</span>
              <span className="dvm-crop-panel">Name panel covers this area</span>
            </div>
          )}
        </div>
        <label className="dvm-zoom">
          <i className="fas fa-magnifying-glass-minus" aria-hidden="true"></i>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
          <i className="fas fa-magnifying-glass-plus" aria-hidden="true"></i>
        </label>
        <p className="dvm-hint"><i className="fas fa-hand-pointer" aria-hidden="true"></i> Drag to move, zoom to fit. Keep the face in the upper area.</p>
      </div>
      <aside className="dvm-crop-side" aria-label="How the card will look">
        <span className="dvm-label">On the card</span>
        <ul className="dw-tokens dvm-card-preview">
          <DeveloperCard dev={{ ...dev, id: 'preview', photoUrl: preview }} />
        </ul>
        {lowRes && (
          <p className="dvm-warn" role="status">
            <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
            This photo is low resolution and may look blurry. A larger photo, or less zoom, looks sharper.
          </p>
        )}
        {error && <p className="dvm-error" role="alert">{error}</p>}
        <div className="dvm-crop-actions">
          <button type="button" className="dvm-btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="dvm-btn is-primary" onClick={use} disabled={!area || busy}>
            {busy ? <><i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Preparing…</> : 'Use this photo'}
          </button>
        </div>
      </aside>
    </div>
  );
}
