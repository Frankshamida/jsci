'use client';

// /news-management/poster/<article id> - a Facebook poster (1126 x 1408)
// made from a news article. Admin and Super Admin only (the page checks, and
// so does every API call).
//
//   Left:   the poster, live. Drag the photo to move it; scroll, pinch or use
//           the slider to zoom; click a headline word to make it gold.
//   Right:  Design (template, headline, subtext, photo, credit, footer) and
//           Versions (this article's saved posters).
//   Top:    AI fill, Save, and Download as PNG or JPG at 1x or 2x.
//
// Editing the headline here never changes the article.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUserRoles } from '@/lib/permissions';
import { newsImage, timeAgo } from '@/lib/news';
import { uploadNewsImage } from '@/lib/newsUpload';
import {
  DEFAULT_CROP, POSTER_HEIGHT, POSTER_LOGO, POSTER_TEMPLATES, POSTER_WIDTH, POSTER_ZOOM, clampCrop, familyForImage,
  headlineWords, highlightMarks, normalizePosterData, posterTemplate, templateFor, toggleHighlight, zoomCropAt,
} from '@/lib/posterTemplates';
import { canvasBlob, loadPosterImage, posterImageUrl, renderPoster } from '@/lib/posterRender';
import '../poster.css';

const EDITOR_ROLES = ['Admin', 'Super Admin'];
const THUMB_SCALE = 0.12;
const SAVED_THUMB_SCALE = 0.16;

// The font-family lists next/font made for Outfit (root layout) and Poppins
// (poster layout), loaded before anything is drawn so the poster never falls
// back to another font.
function readFonts(el) {
  const css = (name) => getComputedStyle(el).getPropertyValue(name).trim();
  return {
    outfit: css('--font-outfit') || 'Outfit, sans-serif',
    poppins: css('--font-poppins') || 'Poppins, sans-serif',
  };
}
async function loadFonts(fonts) {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  await Promise.all([
    `800 68px ${fonts.outfit}`, `600 30px ${fonts.outfit}`,
    `400 22px ${fonts.poppins}`, `500 20px ${fonts.poppins}`, `600 26px ${fonts.poppins}`,
  ].map((f) => document.fonts.load(f, 'AZaz09').catch(() => null)));
  await document.fonts.ready;
}

// What counts as a change (the name is saved on its own, by renaming).
const snapOf = (p) => (p ? JSON.stringify({ template: p.template, data: p.data }) : null);

const fromRow = (row) => ({ id: row.id, name: row.name, template: row.template_key, data: normalizePosterData(row.data) });

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pe-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export default function PosterEditor({ params, searchParams }) {
  const router = useRouter();
  const articleId = params.articleId;
  const fromStudio = searchParams?.from === 'studio';

  const [user, setUser] = useState(null);
  const [allowed, setAllowed] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [article, setArticle] = useState(null);
  const [images, setImages] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [posters, setPosters] = useState([]);
  const [setupNote, setSetupNote] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [poster, setPoster] = useState(null);
  const [savedSnap, setSavedSnap] = useState(null);
  const [fonts, setFonts] = useState(null);
  const [logo, setLogo] = useState(undefined); // undefined while loading, null if it failed
  const [photo, setPhoto] = useState(null);
  const [photoState, setPhotoState] = useState('none'); // none | loading | ok | tainted | error
  const [textInfo, setTextInfo] = useState({ overflow: false, lines: 0 });
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('design');
  const [scale, setScale] = useState(1);
  const [renaming, setRenaming] = useState(null); // { id, name }

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const thumbRefs = useRef({});
  const layoutRef = useRef(null);
  const posterRef = useRef(null);
  const assetsRef = useRef({});
  const liveCrop = useRef(null);
  const gesture = useRef(null);
  const pointers = useRef(new Map());
  const frameReq = useRef(0);
  const wheelTimer = useRef(0);

  posterRef.current = poster;
  const assets = useMemo(() => ({ fonts, logo: logo || null, photo }), [fonts, logo, photo]);
  assetsRef.current = assets;
  const template = poster ? posterTemplate(poster.template) : POSTER_TEMPLATES[0];
  const ready = Boolean(poster && fonts && logo !== undefined);
  const changed = Boolean(poster) && snapOf(poster) !== savedSnap;

  const notify = useCallback((type, text) => {
    setToast({ type, text });
    if (type !== 'error') setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), 4500);
  }, []);
  const setBusyKey = (key, on) => setBusy((b) => ({ ...b, [key]: on }));
  const setData = useCallback((patch) => setPoster((p) => (p ? { ...p, data: { ...p.data, ...patch } } : p)), []);

  // ---- Who is here ----
  useEffect(() => {
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}'); } catch { /* signed out */ }
    if (!stored?.id) { router.replace('/login'); return; }
    setUser(stored);
    setAllowed(getUserRoles(stored).some((r) => EDITOR_ROLES.includes(r)));
  }, [router]);

  // ---- Fonts and the logo ----
  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    const el = rootRef.current || document.documentElement;
    const f = readFonts(el);
    loadFonts(f).finally(() => { if (live) setFonts(f); });
    loadPosterImage(POSTER_LOGO).then((l) => { if (live) setLogo(l); }).catch(() => { if (live) setLogo(null); });
    return () => { live = false; };
  }, [allowed]);

  // A fresh poster from the article: its title, its featured picture (or the
  // first one in it), the author's credit and the church's footer.
  const freshPoster = useCallback(async (a, imgs, defs, count) => {
    const first = a.featured_image_url
      ? { url: a.featured_image_url, publicId: a.featured_image_public_id }
      : imgs[0] || null;
    let family = 'landscape';
    if (first) {
      try {
        const p = await loadPosterImage(posterImageUrl(first.url));
        family = familyForImage(p.width, p.height);
      } catch { /* drawn without it */ }
    }
    return {
      id: null,
      name: `Poster ${count + 1}`,
      template: templateFor(family, false).key,
      data: normalizePosterData({
        headline: a.title,
        highlights: [],
        subtext: '',
        showSubtext: false,
        credit: a.author_name ? `PHOTO OF: ${a.author_name.toUpperCase()}` : '',
        showCredit: Boolean(a.author_name),
        website: defs.website,
        facebook: defs.facebook,
        imageUrl: first?.url || null,
        imagePublicId: first?.publicId || null,
        crop: DEFAULT_CROP,
      }),
    };
  }, []);

  // ---- The article and its posters ----
  useEffect(() => {
    if (!allowed || !user) return;
    (async () => {
      try {
        const res = await fetch(`/api/news/posters?actorId=${encodeURIComponent(user.id)}&articleId=${encodeURIComponent(articleId)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!json.success) throw new Error(json.message || 'Could not open the poster editor.');
        const d = json.data;
        setArticle(d.article);
        setImages(d.images || []);
        setPosters(d.posters || []);
        setSetupNote(d.setupNote || null);
        setDefaults(d.defaults);
        // The last poster worked on, or a new one.
        const start = d.posters?.length ? fromRow(d.posters[0]) : await freshPoster(d.article, d.images || [], d.defaults, 0);
        setPoster(start);
        setSavedSnap(snapOf(start));
      } catch (err) {
        setLoadError(err.message);
      }
    })();
  }, [allowed, user, articleId, freshPoster]);

  // ---- The photo ----
  const imageUrl = poster?.data.imageUrl || null;
  useEffect(() => {
    if (!imageUrl) { setPhoto(null); setPhotoState('none'); return undefined; }
    let live = true;
    setPhotoState('loading');
    loadPosterImage(posterImageUrl(imageUrl))
      .then((p) => { if (live) { setPhoto(p); setPhotoState(p.tainted ? 'tainted' : 'ok'); } })
      .catch(() => { if (live) { setPhoto(null); setPhotoState('error'); } });
    return () => { live = false; };
  }, [imageUrl]);

  // ---- Drawing ----
  const draw = useCallback(() => {
    const p = posterRef.current;
    const c = canvasRef.current;
    if (!p || !c || !assetsRef.current.fonts) return;
    const data = liveCrop.current ? { ...p.data, crop: liveCrop.current } : p.data;
    const out = renderPoster(c, { template: posterTemplate(p.template), data, assets: assetsRef.current, placeholder: true });
    layoutRef.current = out;
    setTextInfo((cur) => (cur.overflow === out.overflow && cur.lines === out.lines ? cur : { overflow: out.overflow, lines: out.lines }));
  }, []);

  const drawSoon = useCallback(() => {
    cancelAnimationFrame(frameReq.current);
    frameReq.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => { if (ready) drawSoon(); }, [ready, poster, assets, drawSoon]);

  // The four template pictures, drawn small with this poster's words and photo.
  useEffect(() => {
    if (!ready || tab !== 'design') return undefined;
    const t = setTimeout(() => {
      const data = {
        ...poster.data,
        headline: poster.data.headline || 'Your headline here',
        subtext: poster.data.subtext || 'Date  |  Place',
      };
      POSTER_TEMPLATES.forEach((tp) => {
        const c = thumbRefs.current[tp.key];
        if (c) renderPoster(c, { template: tp, data, scale: THUMB_SCALE, assets });
      });
    }, 220);
    return () => clearTimeout(t);
  }, [ready, tab, poster?.data, assets]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Moving and zooming the photo on the poster ----
  const toPoster = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * POSTER_WIDTH) / r.width, y: ((e.clientY - r.top) * POSTER_HEIGHT) / r.height };
  };
  const frameOf = (p) => posterTemplate(p.template).photo.frame;
  const inFrame = (p, pt) => { const f = frameOf(p); return pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + f.h; };
  const wordAt = (pt) => (layoutRef.current?.words || []).find((b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h);

  const commitCrop = useCallback(() => {
    if (!liveCrop.current) return;
    const crop = liveCrop.current;
    liveCrop.current = null;
    setData({ crop });
  }, [setData]);

  const toggleWord = useCallback((i) => {
    setPoster((p) => (p ? { ...p, data: { ...p.data, highlights: toggleHighlight(p.data.headline, p.data.highlights, i) } } : p));
  }, []);

  const onPointerDown = (e) => {
    const p = posterRef.current;
    if (!p || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pt = toPoster(e);
    pointers.current.set(e.pointerId, pt);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* keeps working without it */ }
    const ph = assetsRef.current.photo;
    const crop = liveCrop.current || p.data.crop;
    if (pointers.current.size === 1) {
      gesture.current = { type: ph && inFrame(p, pt) ? 'drag' : 'tap', start: pt, crop, moved: false };
      if (gesture.current.type === 'drag') e.currentTarget.style.cursor = 'grabbing';
    } else if (pointers.current.size === 2 && ph) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, crop, moved: true };
    }
  };

  const onPointerMove = (e) => {
    const p = posterRef.current;
    if (!p) return;
    const pt = toPoster(e);
    const ph = assetsRef.current.photo;
    if (!pointers.current.has(e.pointerId)) {
      // Just hovering: show what a press would do.
      e.currentTarget.style.cursor = wordAt(pt) ? 'pointer' : ph && inFrame(p, pt) ? 'grab' : 'default';
      return;
    }
    pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    if (!g || !ph) return;
    const fr = frameOf(p);
    if (g.type === 'drag') {
      const dx = pt.x - g.start.x;
      const dy = pt.y - g.start.y;
      if (Math.hypot(dx, dy) > 4) g.moved = true;
      if (!g.moved) return;
      const scaleNow = Math.max(fr.w / ph.width, fr.h / ph.height) * g.crop.zoom;
      const c = clampCrop(ph.width, ph.height, fr, g.crop);
      liveCrop.current = clampCrop(ph.width, ph.height, fr, {
        zoom: c.zoom,
        x: c.x - dx / (ph.width * scaleNow),
        y: c.y - dy / (ph.height * scaleNow),
      });
      drawSoon();
    } else if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      liveCrop.current = zoomCropAt(ph.width, ph.height, fr, g.crop, g.crop.zoom * (dist / g.dist), g.mid.x, g.mid.y);
      drawSoon();
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return; // a finger is still down
    gesture.current = null;
    e.currentTarget.style.cursor = '';
    if (g && !g.moved) {
      const hit = wordAt(g.start);
      if (hit) toggleWord(hit.i);
    }
    commitCrop();
  };

  const fitPhoto = useCallback(() => {
    const p = posterRef.current;
    const ph = assetsRef.current.photo;
    if (!p || !ph) return;
    setData({ crop: clampCrop(ph.width, ph.height, frameOf(p), { ...p.data.crop, zoom: 1 }) });
  }, [setData]);

  // Scroll to zoom, round the point under the mouse. (A listener of our own,
  // because React's wheel events cannot stop the page from scrolling.)
  useEffect(() => {
    const c = canvasRef.current;
    if (!ready || !c) return undefined;
    const onWheel = (e) => {
      const p = posterRef.current;
      const ph = assetsRef.current.photo;
      if (!p || !ph) return;
      const pt = toPoster(e);
      if (!inFrame(p, pt)) return;
      e.preventDefault();
      const base = liveCrop.current || p.data.crop;
      const step = e.ctrlKey ? 0.01 : 0.0015; // a trackpad pinch arrives as ctrl + wheel
      liveCrop.current = zoomCropAt(ph.width, ph.height, frameOf(p), base, base.zoom * Math.exp(-e.deltaY * step), pt.x, pt.y);
      drawSoon();
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(commitCrop, 180);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [ready, drawSoon, commitCrop]); // eslint-disable-line react-hooks/exhaustive-deps

  const setZoom = (zoom) => {
    const ph = photo;
    if (!ph) return;
    setData({ crop: clampCrop(ph.width, ph.height, template.photo.frame, { ...poster.data.crop, zoom }) });
  };

  // ---- Template, photo, words ----
  const chooseTemplate = (key) => {
    const t = posterTemplate(key);
    setPoster((p) => ({ ...p, template: t.key, data: { ...p.data, showSubtext: t.subtext, templateLocked: true } }));
  };

  const setSubtextOn = (on) => {
    setPoster((p) => ({ ...p, template: templateFor(posterTemplate(p.template).family, on).key, data: { ...p.data, showSubtext: on } }));
  };

  // A new photo: back to fitting the card, and the landscape or portrait
  // card picked for it again.
  const choosePhoto = async (url, publicId) => {
    if (!url || url === poster?.data.imageUrl) return;
    setBusyKey('photo', true);
    try {
      const p = await loadPosterImage(posterImageUrl(url));
      setPoster((cur) => ({
        ...cur,
        template: templateFor(familyForImage(p.width, p.height), posterTemplate(cur.template).subtext).key,
        data: { ...cur.data, imageUrl: url, imagePublicId: publicId || null, crop: DEFAULT_CROP, templateLocked: false },
      }));
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('photo', false);
    }
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setBusyKey('upload', true);
    try {
      const up = await uploadNewsImage(file, user.id);
      setUploads((list) => [up, ...list]);
      await choosePhoto(up.url, up.publicId);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('upload', false);
    }
  };

  const sources = useMemo(() => {
    const list = [];
    const add = (url, publicId, label) => { if (url && !list.some((s) => s.url === url)) list.push({ url, publicId, label }); };
    if (article) add(article.featured_image_url, article.featured_image_public_id, 'Featured picture');
    uploads.forEach((u) => add(u.url, u.publicId, 'Uploaded'));
    images.forEach((img) => add(img.url, img.publicId, img.caption || 'From the article'));
    if (poster?.data.imageUrl) add(poster.data.imageUrl, poster.data.imagePublicId, 'This poster\'s photo');
    return list;
  }, [article, uploads, images, poster?.data.imageUrl, poster?.data.imagePublicId]);

  // ---- AI ----
  const runAi = async (mode) => {
    setBusyKey(`ai-${mode}`, true);
    try {
      const res = await fetch('/api/news/poster-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: user.id, articleId, mode, headline: poster.data.headline, subtext: poster.data.subtext }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The AI could not do that. Please try again.');
      const d = json.data;
      setPoster((cur) => {
        const patch = {};
        if (d.headline !== undefined) patch.headline = d.headline;
        if (d.highlight !== undefined) patch.highlights = d.highlight;
        let key = cur.template;
        if (d.subtext) {
          patch.subtext = d.subtext;
          patch.showSubtext = true;
          key = templateFor(posterTemplate(cur.template).family, true).key;
        }
        return { ...cur, template: key, data: { ...cur.data, ...patch } };
      });
      const done = {
        all: 'Filled in from the article. Check the words, then save.',
        headline: 'New headline.',
        highlight: d.highlight?.length ? 'New highlight.' : 'The AI found no words to highlight. Click a word to do it yourself.',
        subtext: 'New subtext.',
      };
      notify(d.note ? 'info' : 'ok', d.note || done[mode]);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey(`ai-${mode}`, false);
    }
  };

  // ---- Saving ----
  const thumbnail = () => {
    try {
      const c = document.createElement('canvas');
      renderPoster(c, { template: posterTemplate(poster.template), data: poster.data, scale: SAVED_THUMB_SCALE, assets });
      return c.toDataURL('image/jpeg', 0.8);
    } catch {
      return null; // a photo without CORS: saved without a thumbnail
    }
  };

  const api = async (method, body) => {
    const res = await fetch('/api/news/posters', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: user.id, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success) throw new Error(json.message || 'Something went wrong. Please try again.');
    return json.data;
  };

  const save = async () => {
    if (setupNote) { notify('error', setupNote); return; }
    if (busy.save) return;
    const sent = poster;
    setBusyKey('save', true);
    try {
      const fields = { name: sent.name, template_key: sent.template, data: sent.data, preview_url: thumbnail() };
      const row = sent.id
        ? await api('PUT', { id: sent.id, poster: fields })
        : await api('POST', { articleId, poster: fields });
      setPosters((list) => [row, ...list.filter((p) => p.id !== row.id)]);
      setPoster((cur) => ({ ...cur, id: row.id }));
      setSavedSnap(snapOf(sent));
      notify('ok', sent.id ? `"${row.name}" saved.` : `Saved as "${row.name}".`);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('save', false);
    }
  };

  const openVersion = (row) => {
    if (poster?.id === row.id) { setTab('design'); return; }
    if (changed && !window.confirm('This poster has changes that are not saved. Open the other one anyway?')) return;
    const next = fromRow(row);
    liveCrop.current = null;
    setPoster(next);
    setSavedSnap(snapOf(next));
    setTab('design');
  };

  const newPoster = async () => {
    if (changed && !window.confirm('This poster has changes that are not saved. Start a new one anyway?')) return;
    const next = await freshPoster(article, images, defaults, posters.length);
    liveCrop.current = null;
    setPoster(next);
    setSavedSnap(snapOf(next));
    setTab('design');
  };

  const duplicate = async (row) => {
    setBusyKey(`v-${row.id}`, true);
    try {
      const copy = await api('POST', {
        articleId,
        poster: { name: `${row.name} copy`.slice(0, 60), template_key: row.template_key, data: row.data, preview_url: row.preview_url },
      });
      setPosters((list) => [copy, ...list]);
      notify('ok', `Made "${copy.name}".`);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey(`v-${row.id}`, false);
    }
  };

  const rename = async () => {
    const r = renaming;
    setRenaming(null);
    const name = String(r?.name || '').trim().slice(0, 60);
    const row = posters.find((p) => p.id === r?.id);
    if (!row || !name || name === row.name) return;
    try {
      const saved = await api('PUT', { id: row.id, poster: { name } });
      setPosters((list) => list.map((p) => (p.id === saved.id ? { ...p, name: saved.name } : p)));
      if (poster?.id === saved.id) setPoster((cur) => ({ ...cur, name: saved.name }));
    } catch (err) {
      notify('error', err.message);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
    setBusyKey(`v-${row.id}`, true);
    try {
      await api('DELETE', { id: row.id });
      setPosters((list) => list.filter((p) => p.id !== row.id));
      if (poster?.id === row.id) setPoster((cur) => ({ ...cur, id: null }));
      notify('ok', `"${row.name}" deleted.`);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey(`v-${row.id}`, false);
    }
  };

  const saveDefaults = async () => {
    setBusyKey('defaults', true);
    try {
      const d = await api('PUT', { defaults: { website: poster.data.website, facebook: poster.data.facebook } });
      setDefaults(d);
      notify('ok', 'New posters will use this website and Facebook page.');
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('defaults', false);
    }
  };

  // ---- Download ----
  const download = async (type) => {
    setBusyKey('download', true);
    try {
      await loadFonts(fonts);
      const c = document.createElement('canvas');
      renderPoster(c, { template, data: poster.data, scale, assets, cache: scale === 1 });
      const blob = await canvasBlob(c, type === 'png' ? 'image/png' : 'image/jpeg', 0.92);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `poster-${article.slug || 'news'}-${template.key}-${today()}${scale === 2 ? '-2x' : ''}.${type === 'png' ? 'png' : 'jpg'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify('ok', `Downloaded: ${c.width} × ${c.height} ${type.toUpperCase()}.`);
    } catch (err) {
      notify('error', err?.name === 'SecurityError'
        ? 'This photo comes from a site that does not allow it to be saved into a picture. Upload the photo instead.'
        : err.message);
    } finally {
      setBusyKey('download', false);
    }
  };

  // ---- Leaving ----
  useEffect(() => {
    const warn = (e) => { if (changed) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (poster && !setupNote) save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const back = () => {
    if (changed && !window.confirm('This poster has changes that are not saved. Leave anyway?')) return;
    router.push(fromStudio ? `/news-studio/${articleId}` : '/news-management');
  };

  // ---- Not allowed / loading ----
  if (allowed === false) {
    return (
      <div className="pe-gate" ref={rootRef}>
        <img src="/assets/LOGO.png" alt="" />
        <h1>Posters are for Admins</h1>
        <p>Only an Admin or a Super Admin can make news posters.</p>
        <button type="button" onClick={() => router.push('/dashboard')}>Back to the dashboard</button>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="pe-gate" ref={rootRef}>
        <i className="fas fa-triangle-exclamation"></i>
        <p>{loadError}</p>
        <button type="button" onClick={() => router.push('/news-management')}>Back to News</button>
      </div>
    );
  }
  if (!ready) {
    return <div className="pe-gate" ref={rootRef}><i className="fas fa-spinner fa-spin"></i><p>Opening the poster editor…</p></div>;
  }

  const d = poster.data;
  const words = headlineWords(d.headline);
  const marks = highlightMarks(words, d.highlights);
  const zoomPct = Math.round((d.crop?.zoom || 1) * 100);
  const footerChanged = defaults && (d.website !== defaults.website || d.facebook !== defaults.facebook);
  const status = !poster.id ? 'Not saved yet' : changed ? 'Unsaved changes' : 'Saved';
  const aiBusy = Object.keys(busy).some((k) => k.startsWith('ai-') && busy[k]);

  return (
    <div className="pe-app" ref={rootRef}>
      {/* ---- Top bar ---- */}
      <header className="pe-top">
        <button type="button" className="pe-back" onClick={back} aria-label={fromStudio ? 'Back to the article' : 'Back to News'}><i className="fas fa-arrow-left"></i></button>
        <div className="pe-top-title">
          <strong>{poster.name}</strong>
          <span className={`pe-status ${poster.id && !changed ? 'ok' : ''}`}>{status} · {article.title}</span>
        </div>
        <div className="pe-top-actions">
          <button type="button" className="pe-ai" disabled={aiBusy} onClick={() => runAi('all')} title="Let the AI write the headline, highlight and subtext from the article">
            {busy['ai-all'] ? <i className="fas fa-spinner fa-spin"></i> : <span aria-hidden="true">✨</span>} <span className="pe-label">AI fill</span>
          </button>
          <button type="button" className="pe-save" disabled={busy.save || Boolean(setupNote)} onClick={save} title={setupNote || 'Save this version (Ctrl+S)'}>
            {busy.save ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-floppy-disk"></i>} <span className="pe-label">Save version</span>
          </button>
          <div className="pe-export">
            <div className="pe-seg" role="group" aria-label="Size">
              <button type="button" className={scale === 1 ? 'on' : ''} onClick={() => setScale(1)} title="1126 × 1408">1×</button>
              <button type="button" className={scale === 2 ? 'on' : ''} onClick={() => setScale(2)} title="2252 × 2816, sharper on Facebook">2×</button>
            </div>
            <button type="button" disabled={busy.download} onClick={() => download('png')}><i className="fas fa-download"></i> PNG</button>
            <button type="button" disabled={busy.download} onClick={() => download('jpg')}><i className="fas fa-download"></i> JPG</button>
          </div>
        </div>
      </header>

      <div className="pe-body">
        {/* ---- The poster ---- */}
        <main className="pe-stage">
          <div className="pe-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="pe-canvas"
              width={POSTER_WIDTH}
              height={POSTER_HEIGHT}
              aria-label="Poster preview"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={(e) => { if (inFrame(poster, toPoster(e))) fitPhoto(); }}
            />
            {(photoState === 'loading' || busy.photo || busy.upload) && (
              <div className="pe-canvas-busy"><i className="fas fa-spinner fa-spin"></i> {busy.upload ? 'Uploading the photo…' : 'Loading the photo…'}</div>
            )}
          </div>
          <p className="pe-hint">
            <i className="fas fa-hand"></i> Drag the photo to move it · scroll or pinch to zoom · double-click to fit · click a headline word to make it gold
          </p>
        </main>

        {/* ---- Controls ---- */}
        <aside className="pe-panel">
          <div className="pe-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'design'} className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>
              <i className="fas fa-palette"></i> Design
            </button>
            <button type="button" role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? 'on' : ''} onClick={() => setTab('versions')}>
              <i className="fas fa-layer-group"></i> Versions <span className="pe-count">{posters.length}</span>
            </button>
          </div>

          <div className="pe-scroll">
            {setupNote && <p className="pe-note"><i className="fas fa-database"></i> {setupNote}</p>}

            {tab === 'design' ? (
              <>
                <section className="pe-sec">
                  <h3>Template</h3>
                  <div className="pe-templates">
                    {POSTER_TEMPLATES.map((t) => (
                      <button key={t.key} type="button" className={`pe-template ${poster.template === t.key ? 'on' : ''}`} onClick={() => chooseTemplate(t.key)} aria-pressed={poster.template === t.key}>
                        <canvas ref={(el) => { thumbRefs.current[t.key] = el; }} width={Math.round(POSTER_WIDTH * THUMB_SCALE)} height={Math.round(POSTER_HEIGHT * THUMB_SCALE)} />
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                  {!d.templateLocked && photo && <p className="pe-small">Picked for this {template.family} photo. Choose another to change it.</p>}
                </section>

                <section className="pe-sec">
                  <div className="pe-sec-head">
                    <h3>Headline</h3>
                    <button type="button" className="pe-regen" disabled={aiBusy} onClick={() => runAi('headline')}>
                      {busy['ai-headline'] ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate"></i>} Regenerate
                    </button>
                  </div>
                  <textarea
                    className="pe-input pe-headline"
                    value={d.headline}
                    rows={3}
                    maxLength={200}
                    placeholder="The headline on the poster"
                    onChange={(e) => setData({ headline: e.target.value.replace(/\s*\n\s*/g, ' ') })}
                  />
                  {textInfo.overflow && (
                    <p className="pe-warn"><i className="fas fa-triangle-exclamation"></i> This is too long for three lines. Shorten it so it fits nicely.</p>
                  )}
                  <div className="pe-sec-head sub">
                    <span>Gold words <small>click to turn on or off</small></span>
                    <button type="button" className="pe-regen" disabled={aiBusy || !words.length} onClick={() => runAi('highlight')}>
                      {busy['ai-highlight'] ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate"></i>} Regenerate
                    </button>
                  </div>
                  <div className="pe-chips">
                    {words.map((w, i) => (
                      <button key={`${w}-${i}`} type="button" className={`pe-chip ${marks[i] ? 'on' : ''}`} aria-pressed={marks[i]} onClick={() => toggleWord(i)}>
                        {w.toUpperCase()}
                      </button>
                    ))}
                    {!words.length && <span className="pe-small">Write a headline first.</span>}
                  </div>
                </section>

                <section className="pe-sec">
                  <div className="pe-sec-head">
                    <h3>Subtext</h3>
                    <Switch on={template.subtext} onChange={setSubtextOn} label="Show the subtext" />
                  </div>
                  {template.subtext && (
                    <>
                      <div className="pe-row">
                        <input
                          className="pe-input"
                          value={d.subtext}
                          maxLength={140}
                          placeholder="NOVEMBER 15, 2026 | MAIN SANCTUARY"
                          onChange={(e) => setData({ subtext: e.target.value })}
                        />
                        <button type="button" className="pe-regen icon" disabled={aiBusy} onClick={() => runAi('subtext')} title="Regenerate the subtext from the article">
                          {busy['ai-subtext'] ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate"></i>}
                        </button>
                      </div>
                      <p className="pe-small">Separate facts with | . Only use facts from the article.</p>
                    </>
                  )}
                </section>

                <section className="pe-sec">
                  <h3>Photo</h3>
                  <div className="pe-photos">
                    {sources.map((s) => (
                      <button key={s.url} type="button" className={`pe-photo ${d.imageUrl === s.url ? 'on' : ''}`} onClick={() => choosePhoto(s.url, s.publicId)} title={s.label} disabled={busy.photo}>
                        <img src={newsImage(s.url, 200)} alt={s.label} loading="lazy" />
                      </button>
                    ))}
                    <label className={`pe-photo pe-upload ${busy.upload ? 'busy' : ''}`} title="Upload a photo">
                      <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy.upload} onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                      {busy.upload ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-arrow-up-from-bracket"></i>}
                      <span>Upload</span>
                    </label>
                  </div>
                  {photoState === 'error' && <p className="pe-warn"><i className="fas fa-triangle-exclamation"></i> This photo could not be loaded. Choose or upload another.</p>}
                  {photoState === 'tainted' && <p className="pe-warn"><i className="fas fa-triangle-exclamation"></i> This photo is from another site, so the poster cannot be downloaded with it. Upload the photo instead.</p>}
                  {photo && (
                    <>
                      <div className="pe-zoom">
                        <button type="button" onClick={() => setZoom((d.crop.zoom || 1) - 0.1)} aria-label="Zoom out" disabled={zoomPct <= 100}><i className="fas fa-minus"></i></button>
                        <input
                          type="range"
                          min={POSTER_ZOOM.min * 100}
                          max={POSTER_ZOOM.max * 100}
                          step={1}
                          value={zoomPct}
                          onChange={(e) => setZoom(Number(e.target.value) / 100)}
                          aria-label="Zoom"
                        />
                        <button type="button" onClick={() => setZoom((d.crop.zoom || 1) + 0.1)} aria-label="Zoom in" disabled={zoomPct >= 300}><i className="fas fa-plus"></i></button>
                        <span className="pe-zoom-val">{zoomPct}%</span>
                      </div>
                      <div className="pe-btnrow">
                        <button type="button" className="pe-soft" onClick={fitPhoto}><i className="fas fa-expand"></i> Fit</button>
                        <button type="button" className="pe-soft" onClick={() => setData({ crop: DEFAULT_CROP })}><i className="fas fa-arrows-rotate"></i> Reset</button>
                      </div>
                    </>
                  )}
                </section>

                <section className="pe-sec">
                  <div className="pe-sec-head">
                    <h3>Photo credit</h3>
                    <Switch on={d.showCredit} onChange={(on) => setData({ showCredit: on })} label="Show the photo credit" />
                  </div>
                  {d.showCredit && (
                    <input className="pe-input" value={d.credit} maxLength={90} placeholder="PHOTO OF: NAME" onChange={(e) => setData({ credit: e.target.value })} />
                  )}
                </section>

                <section className="pe-sec">
                  <h3>Footer</h3>
                  <label className="pe-field">
                    <span><i className="fas fa-globe"></i> Website</span>
                    <input className="pe-input" value={d.website} maxLength={80} onChange={(e) => setData({ website: e.target.value })} />
                  </label>
                  <label className="pe-field">
                    <span><i className="fab fa-facebook"></i> Facebook</span>
                    <input className="pe-input" value={d.facebook} maxLength={80} onChange={(e) => setData({ facebook: e.target.value })} />
                  </label>
                  <div className="pe-btnrow">
                    <button type="button" className="pe-soft" disabled={!footerChanged || busy.defaults} onClick={saveDefaults}>
                      {busy.defaults ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-bookmark"></i>} Save as church default
                    </button>
                    {footerChanged && (
                      <button type="button" className="pe-soft" onClick={() => setData({ website: defaults.website, facebook: defaults.facebook })}>Use the default</button>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <section className="pe-sec">
                <button type="button" className="pe-new" onClick={newPoster}><i className="fas fa-plus"></i> New poster from the article</button>
                {!posters.length && <p className="pe-empty">No saved versions yet. Press <strong>Save version</strong> to keep this poster.</p>}
                <ul className="pe-versions">
                  {posters.map((row) => {
                    const current = poster.id === row.id;
                    return (
                      <li key={row.id} className={`${current ? 'on' : ''} ${busy[`v-${row.id}`] ? 'busy' : ''}`}>
                        <button type="button" className="pe-v-thumb" onClick={() => openVersion(row)} aria-label={`Open ${row.name}`}>
                          {row.preview_url ? <img src={row.preview_url} alt="" /> : <i className="far fa-image"></i>}
                        </button>
                        <div className="pe-v-main">
                          {renaming?.id === row.id ? (
                            <input
                              className="pe-input"
                              value={renaming.name}
                              maxLength={60}
                              autoFocus
                              onChange={(e) => setRenaming({ id: row.id, name: e.target.value })}
                              onBlur={rename}
                              onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }}
                            />
                          ) : (
                            <strong>{row.name}{current && <em>Open</em>}</strong>
                          )}
                          <span>{posterTemplate(row.template_key).label} · {timeAgo(row.updated_at)}</span>
                          <div className="pe-v-actions">
                            <button type="button" onClick={() => openVersion(row)}>Open</button>
                            <button type="button" onClick={() => duplicate(row)}>Duplicate</button>
                            <button type="button" onClick={() => setRenaming({ id: row.id, name: row.name })}>Rename</button>
                            <button type="button" className="danger" onClick={() => remove(row)}>Delete</button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </aside>
      </div>

      {toast && (
        <div className={`pe-toast ${toast.type}`} role="status">
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Close"><i className="fas fa-xmark"></i></button>
        </div>
      )}
    </div>
  );
}
