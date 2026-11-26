'use client';

// /news-management/poster/<article id> - a Facebook poster made from a news
// article, with any poster template (an SVG that follows the template
// contract: the built-in gold cards, or one an Admin imported). Admin and
// Super Admin only (the page checks, and so does every API call).
//
//   Left:   the poster, live. Drag the photo to move it; scroll, pinch or the
//           slider to zoom; click a word to highlight it.
//   Right:  Content (template, words, photo, credit, footer), Style (text
//           sizes and colours, gradients, photo filters, logos) and Versions.
//   Top:    AI fill, Save, and Download as PNG or JPG at 1x or 2x.
//
// The preview and the download are the same SVG (lib/posterEngine.js), drawn
// as a picture. Editing the headline here never changes the article.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUserRoles } from '@/lib/permissions';
import { newsImage, timeAgo } from '@/lib/news';
import { uploadNewsImage, uploadPosterLogo } from '@/lib/newsUpload';
import { builtinForFamily, builtinTemplate } from '@/lib/posterBuiltins';
import {
  DEFAULT_CROP, HIGHLIGHT_PRESETS, MAX_LOGOS, POSTER_ZOOM, clampCrop, familyForImage, formatSubtext, headlineWords,
  highlightMarks, mergeStyle, normalizePosterData, resolveTemplateKey, toggleHighlight, zoomCropAt,
} from '@/lib/posterTemplates';
import { MAX_TEMPLATE_BYTES, analyzeTemplate, contractProblems, sanitizeSvgDocument } from '@/lib/posterSvgSanitize';
import { convertLegacyTemplate, isLegacyTemplate } from '@/lib/posterLegacy';
import {
  averageLuminance, buildPosterSvg, canvasBlob, embeddedFontCss, inlineImage, loadFonts, makeMeasure, parseSvg,
  prepareTemplate, rasterize, rawTemplateSvg, readFontFamilies, sizedImageUrl,
} from '@/lib/posterEngine';
import '../poster.css';

const EDITOR_ROLES = ['Admin', 'Super Admin'];
const PREVIEW_PHOTO = 1400;
const LOGO_SIZE = { preview: 900, export: 1400 };

const snapOf = (p) => (p ? JSON.stringify({ template: p.template, data: p.data }) : null);
const fromRow = (row) => {
  const { key, data } = resolveTemplateKey(row.template_key, normalizePosterData(row.data));
  return { id: row.id, name: row.name, template: key, data };
};
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const prettyName = (s) => String(s || 'Template').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
const omit = (obj, key) => { const out = { ...(obj || {}) }; delete out[key]; return out; };

// ---- Small controls ----

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pe-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Group({ title, icon, onReset, children, open: startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className={`pe-sec pe-group ${open ? 'open' : ''}`}>
      <div className="pe-group-head">
        <button type="button" className="pe-group-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <i className={icon}></i> {title} <i className="fas fa-chevron-down pe-chev"></i>
        </button>
        {onReset && open && (
          <button type="button" className="pe-reset" onClick={onReset} title="Reset to the template's default">
            <i className="fas fa-rotate-left"></i> Reset
          </button>
        )}
      </div>
      {open && <div className="pe-group-body">{children}</div>}
    </section>
  );
}

function Range({ label, value, min, max, step = 1, unit = '', onChange, disabled }) {
  return (
    <div className={`pe-range ${disabled ? 'off' : ''}`}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(clamp(v, min, max)); }}
        aria-label={`${label} (number)`}
      />
      {unit && <em>{unit}</em>}
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  const [draft, setDraft] = useState(value || '#FFFFFF');
  useEffect(() => { setDraft(value || '#FFFFFF'); }, [value]);
  return (
    <label className="pe-color">
      <span>{label}</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#FFFFFF'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <input
        className="pe-hex"
        value={draft}
        maxLength={7}
        onChange={(e) => { setDraft(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toUpperCase()); }}
        aria-label={`${label} (hex)`}
      />
    </label>
  );
}

function Seg({ value, options, onChange, label }) {
  return (
    <div className="pe-seg-row" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Chips({ text, phrases, onToggle }) {
  const words = headlineWords(text);
  const marks = highlightMarks(words, phrases);
  if (!words.length) return <span className="pe-small">Nothing written yet.</span>;
  return (
    <div className="pe-chips">
      {words.map((w, i) => (
        <button key={`${w}-${i}`} type="button" className={`pe-chip ${marks[i] ? 'on' : ''}`} aria-pressed={marks[i]} onClick={() => onToggle(i)}>
          {w}
        </button>
      ))}
    </div>
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
  const [templates, setTemplates] = useState([]);
  const [templateNote, setTemplateNote] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [poster, setPoster] = useState(null);
  const [savedSnap, setSavedSnap] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [fonts, setFonts] = useState(null);
  const [fontCss, setFontCss] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoState, setPhotoState] = useState('none'); // none | loading | ok | error
  const [logoAssets, setLogoAssets] = useState(() => new Map());
  const [textInfo, setTextInfo] = useState({ overflow: false, headlineSize: null, subtextSize: null });
  const [busy, setBusy] = useState({});
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState('content');
  const [scale, setScale] = useState(1);
  const [renaming, setRenaming] = useState(null);
  const [importing, setImporting] = useState(null);
  const [dragLogo, setDragLogo] = useState(null);

  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const importInput = useRef(null);
  const tplCache = useRef(new Map());
  const thumbsStarted = useRef(new Set());
  const layoutRef = useRef(null);
  const posterRef = useRef(null);
  const tplRef = useRef(null);
  const styleRef = useRef({});
  const envRef = useRef({});
  const liveCrop = useRef(null);
  const gesture = useRef(null);
  const pointers = useRef(new Map());
  const renderState = useRef({ busy: false, pending: false });
  const renderRef = useRef(() => {});
  const wheelTimer = useRef(0);

  const measure = useMemo(() => (fonts ? makeMeasure(fonts) : null), [fonts]);
  const templateRow = poster ? templates.find((t) => t.key === poster.template) : null;
  const style = useMemo(() => mergeStyle(templateRow?.defaults || {}, poster?.data.style || {}), [templateRow, poster?.data.style]);

  posterRef.current = poster;
  tplRef.current = tpl;
  styleRef.current = style;
  envRef.current = { photo, logos: logoAssets, measure, fontCss };

  const ready = Boolean(poster && tpl && measure && fontCss !== null);
  const changed = Boolean(poster) && snapOf(poster) !== savedSnap;

  const notify = useCallback((type, text) => {
    setToast({ type, text });
    if (type !== 'error') setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), 4500);
  }, []);
  const setBusyKey = (key, on) => setBusy((b) => ({ ...b, [key]: on }));
  const setData = useCallback((patch) => setPoster((p) => (p ? { ...p, data: { ...p.data, ...patch } } : p)), []);
  const setStyleGroup = useCallback((group, patch) => setPoster((p) => {
    if (!p) return p;
    const cur = p.data.style || {};
    return { ...p, data: { ...p.data, style: { ...cur, [group]: { ...(cur[group] || {}), ...patch } } } };
  }), []);
  const resetGroup = (group) => setPoster((p) => (p ? { ...p, data: { ...p.data, style: omit(p.data.style, group) } } : p));

  // ---- Who is here ----
  useEffect(() => {
    let stored = {};
    try { stored = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}'); } catch { /* signed out */ }
    if (!stored?.id) { router.replace('/login'); return; }
    setUser(stored);
    setAllowed(getUserRoles(stored).some((r) => EDITOR_ROLES.includes(r)));
  }, [router]);

  // ---- Fonts: loaded for measuring, and embedded for drawing ----
  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    const f = readFontFamilies(rootRef.current || document.documentElement);
    (async () => {
      await loadFonts(f);
      if (!live) return;
      setFonts(f);
      const css = await embeddedFontCss(f).catch(() => '');
      if (live) setFontCss(css);
    })();
    return () => { live = false; };
  }, [allowed]);

  // ---- Templates ----
  const getTemplate = useCallback((key) => {
    const cache = tplCache.current;
    if (!cache.has(key)) {
      const b = builtinTemplate(key);
      const p = b
        ? prepareTemplate(b.svg, { trusted: true })
        : (async () => {
          const res = await fetch(`/api/news/poster-templates?actorId=${encodeURIComponent(user?.id || '')}&key=${encodeURIComponent(key)}`, { cache: 'no-store' });
          const json = await res.json().catch(() => ({}));
          if (!json.success) throw new Error(json.message || 'That template could not be loaded.');
          return prepareTemplate(json.data.svg);
        })();
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return cache.get(key);
  }, [user]);

  // A fresh poster from the article: its title, its featured picture (or the
  // first one in it), the author's credit, the church's footer, and the gold
  // card that suits the photo's shape.
  const freshPoster = useCallback(async (a, imgs, defs, count) => {
    const first = a.featured_image_url ? { url: a.featured_image_url, publicId: a.featured_image_public_id } : imgs[0] || null;
    let family = 'landscape';
    if (first) {
      const pic = await inlineImage(sizedImageUrl(first.url, PREVIEW_PHOTO, { jpg: true })).catch(() => null);
      if (pic) family = familyForImage(pic.width, pic.height);
    }
    return {
      id: null,
      name: `Poster ${count + 1}`,
      template: builtinForFamily(family).key,
      data: normalizePosterData({
        headline: a.title,
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

  // ---- The article, its posters and the templates ----
  useEffect(() => {
    if (!allowed || !user) return;
    (async () => {
      try {
        const [postersRes, templatesRes] = await Promise.all([
          fetch(`/api/news/posters?actorId=${encodeURIComponent(user.id)}&articleId=${encodeURIComponent(articleId)}`, { cache: 'no-store' }),
          fetch(`/api/news/poster-templates?actorId=${encodeURIComponent(user.id)}`, { cache: 'no-store' }),
        ]);
        const json = await postersRes.json().catch(() => ({}));
        if (!json.success) throw new Error(json.message || 'Could not open the poster editor.');
        const tj = await templatesRes.json().catch(() => ({}));
        if (tj.success) {
          setTemplates(tj.data.templates || []);
          setTemplateNote(tj.data.setupNote || null);
        } else {
          setTemplates([]);
          setTemplateNote(tj.message || 'The templates could not be loaded.');
        }
        const d = json.data;
        setArticle(d.article);
        setImages(d.images || []);
        setPosters(d.posters || []);
        setSetupNote(d.setupNote || null);
        setDefaults(d.defaults);
        const start = d.posters?.length ? fromRow(d.posters[0]) : await freshPoster(d.article, d.images || [], d.defaults, 0);
        setPoster(start);
        setSavedSnap(snapOf(start));
      } catch (err) {
        setLoadError(err.message);
      }
    })();
  }, [allowed, user, articleId, freshPoster]);

  // The open poster's template, read and ready.
  const templateKey = poster?.template;
  useEffect(() => {
    if (!templateKey || !user) return undefined;
    let live = true;
    getTemplate(templateKey)
      .then((t) => { if (live) setTpl({ key: templateKey, ...t }); })
      .catch((err) => {
        if (!live) return;
        notify('error', `${err.message} Showing the gold card instead.`);
        setPoster((p) => (p ? { ...p, template: 'landscape' } : p));
      });
    return () => { live = false; };
  }, [templateKey, user, getTemplate, notify]);

  // Template pictures for the built-ins (imported ones keep the one made at import).
  useEffect(() => {
    if (fontCss === null) return;
    templates.filter((t) => !t.thumbnail_url && !thumbsStarted.current.has(t.key) && builtinTemplate(t.key)).forEach(async (t) => {
      thumbsStarted.current.add(t.key);
      try {
        const prepared = await getTemplate(t.key);
        const c = await rasterize(rawTemplateSvg(prepared, fontCss), 240, (240 * prepared.info.height) / prepared.info.width);
        setThumbs((m) => ({ ...m, [t.key]: c.toDataURL('image/jpeg', 0.8) }));
      } catch { /* the tile shows its name */ }
    });
  }, [templates, fontCss, getTemplate]);

  // ---- The photo ----
  const imageUrl = poster?.data.imageUrl || null;
  useEffect(() => {
    if (!imageUrl) { setPhoto(null); setPhotoState('none'); return undefined; }
    let live = true;
    setPhotoState('loading');
    inlineImage(sizedImageUrl(imageUrl, PREVIEW_PHOTO, { jpg: true }))
      .then((p) => { if (live) { setPhoto(p); setPhotoState('ok'); } })
      .catch(() => { if (live) { setPhoto(null); setPhotoState('error'); } });
    return () => { live = false; };
  }, [imageUrl]);

  // ---- Uploaded logos ----
  const logoItems = useMemo(() => {
    if (!tpl?.info.logo) return [];
    return style.logos?.items || tpl.info.logo.images.map((_, i) => ({ template: i }));
  }, [style.logos?.items, tpl]);
  useEffect(() => {
    const missing = logoItems.filter((it) => it.url && !logoAssets.has(it.url));
    if (!missing.length) return;
    missing.forEach((it) => {
      inlineImage(sizedImageUrl(it.url, LOGO_SIZE.preview, { png: true }))
        .then((pic) => setLogoAssets((m) => new Map(m).set(it.url, pic)))
        .catch(() => notify('error', 'A logo could not be loaded.'));
    });
  }, [logoItems, logoAssets, notify]);

  // ---- Drawing the preview ----
  // One drawing at a time; changes made meanwhile are drawn right after.
  renderRef.current = () => {
    const st = renderState.current;
    if (st.busy) { st.pending = true; return; }
    const p = posterRef.current;
    const t = tplRef.current;
    const env = envRef.current;
    const c = canvasRef.current;
    if (!p || !t || !env.measure || env.fontCss === null || !c) return;
    st.busy = true;
    (async () => {
      try {
        // While the photo is being dragged or zoomed, frames are drawn at half
        // size (a quarter of the work) and stretched; the sharp one follows.
        const moving = Boolean(liveCrop.current);
        const s = moving ? 0.5 : 1;
        const { svg, layout } = buildPosterSvg(t, p.data, styleRef.current, { ...env, crop: liveCrop.current || undefined, scale: s });
        if (moving) {
          const small = await rasterize(svg, t.info.width * s, t.info.height * s, st.small || (st.small = document.createElement('canvas')));
          if (c.width !== t.info.width) c.width = t.info.width;
          if (c.height !== t.info.height) c.height = t.info.height;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(small, 0, 0, c.width, c.height);
        } else {
          await rasterize(svg, t.info.width, t.info.height, c);
        }
        layoutRef.current = layout;
        setTextInfo((cur) => (cur.overflow === layout.overflow && cur.headlineSize === layout.headlineSize && cur.subtextSize === layout.subtextSize
          ? cur : { overflow: layout.overflow, headlineSize: layout.headlineSize, subtextSize: layout.subtextSize }));
      } catch (err) {
        console.error('[poster preview]', err);
      } finally {
        st.busy = false;
        if (st.pending) { st.pending = false; renderRef.current(); }
      }
    })();
  };
  useEffect(() => { if (ready) renderRef.current(); }, [ready, poster, tpl, style, photo, logoAssets, fontCss]);

  // ---- Moving and zooming the photo on the poster ----
  const dims = tpl ? { w: tpl.info.width, h: tpl.info.height } : { w: 1080, h: 1350 };
  const toPoster = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const t = tplRef.current;
    return { x: ((e.clientX - r.left) * t.info.width) / r.width, y: ((e.clientY - r.top) * t.info.height) / r.height };
  };
  const frameNow = () => tplRef.current?.info.photo;
  const inFrame = (pt) => { const f = frameNow(); return f && pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + f.h; };
  const wordAt = (pt) => (layoutRef.current?.words || []).find((b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h);

  const commitCrop = useCallback(() => {
    if (!liveCrop.current) return;
    const crop = liveCrop.current;
    liveCrop.current = null;
    setData({ crop });
  }, [setData]);

  const toggleWord = useCallback((target, i) => {
    setPoster((p) => {
      if (!p) return p;
      if (target === 'subtext') return { ...p, data: { ...p.data, subtextHighlights: toggleHighlight(formatSubtext(p.data.subtext), p.data.subtextHighlights, i) } };
      return { ...p, data: { ...p.data, highlights: toggleHighlight(p.data.headline, p.data.highlights, i) } };
    });
  }, []);

  const onPointerDown = (e) => {
    const p = posterRef.current;
    if (!p || !tplRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const pt = toPoster(e);
    pointers.current.set(e.pointerId, pt);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* keeps working without it */ }
    const ph = envRef.current.photo;
    const crop = liveCrop.current || p.data.crop;
    if (pointers.current.size === 1) {
      gesture.current = { type: ph && inFrame(pt) && !wordAt(pt) ? 'drag' : 'tap', start: pt, crop, moved: false };
      if (gesture.current.type === 'drag') e.currentTarget.style.cursor = 'grabbing';
    } else if (pointers.current.size === 2 && ph) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, crop, moved: true };
    }
  };

  const onPointerMove = (e) => {
    if (!posterRef.current || !tplRef.current) return;
    const pt = toPoster(e);
    const ph = envRef.current.photo;
    if (!pointers.current.has(e.pointerId)) {
      e.currentTarget.style.cursor = wordAt(pt) ? 'pointer' : ph && inFrame(pt) ? 'grab' : 'default';
      return;
    }
    pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    const fr = frameNow();
    if (!g || !ph || !fr) return;
    if (g.type === 'drag') {
      const dx = pt.x - g.start.x;
      const dy = pt.y - g.start.y;
      if (Math.hypot(dx, dy) > 4) g.moved = true;
      if (!g.moved) return;
      const c = clampCrop(ph.width, ph.height, fr, g.crop);
      const s = Math.max(fr.w / ph.width, fr.h / ph.height) * c.zoom;
      liveCrop.current = clampCrop(ph.width, ph.height, fr, { zoom: c.zoom, x: c.x - dx / (ph.width * s), y: c.y - dy / (ph.height * s) });
      renderRef.current();
    } else if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      liveCrop.current = zoomCropAt(ph.width, ph.height, fr, g.crop, g.crop.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist), g.mid.x, g.mid.y);
      renderRef.current();
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    e.currentTarget.style.cursor = '';
    if (g && !g.moved) {
      const hit = wordAt(g.start);
      if (hit) toggleWord(hit.target, hit.i);
    }
    commitCrop();
  };

  const fitPhoto = useCallback(() => {
    const p = posterRef.current;
    const ph = envRef.current.photo;
    const fr = tplRef.current?.info.photo;
    if (!p || !ph || !fr) return;
    setData({ crop: clampCrop(ph.width, ph.height, fr, { ...p.data.crop, zoom: 1 }) });
  }, [setData]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!ready || !c) return undefined;
    const onWheel = (e) => {
      const p = posterRef.current;
      const ph = envRef.current.photo;
      const fr = tplRef.current?.info.photo;
      if (!p || !ph || !fr) return;
      const pt = toPoster(e);
      if (!inFrame(pt)) return;
      e.preventDefault();
      const base = liveCrop.current || p.data.crop;
      const step = e.ctrlKey ? 0.01 : 0.0015;
      liveCrop.current = zoomCropAt(ph.width, ph.height, fr, base, base.zoom * Math.exp(-e.deltaY * step), pt.x, pt.y);
      renderRef.current();
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(commitCrop, 180);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [ready, commitCrop]); // eslint-disable-line react-hooks/exhaustive-deps

  const setZoom = (zoom) => {
    const fr = tpl?.info.photo;
    if (!photo || !fr) return;
    setData({ crop: clampCrop(photo.width, photo.height, fr, { ...poster.data.crop, zoom }) });
  };

  // ---- Template, photo ----
  const chooseTemplate = async (key) => {
    if (key === poster.template) return;
    setBusyKey('template', true);
    try {
      await getTemplate(key);
      setPoster((p) => ({ ...p, template: key, data: { ...p.data, templateLocked: true } }));
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('template', false);
    }
  };

  // A new photo goes back to covering its frame; a built-in gold card
  // follows the photo's shape unless a template was picked by hand.
  const choosePhoto = async (url, publicId) => {
    if (!url || url === poster?.data.imageUrl) return;
    setBusyKey('photo', true);
    try {
      const pic = await inlineImage(sizedImageUrl(url, PREVIEW_PHOTO, { jpg: true }));
      setPoster((cur) => {
        const autoPick = !cur.data.templateLocked && builtinTemplate(cur.template);
        return {
          ...cur,
          template: autoPick ? builtinForFamily(familyForImage(pic.width, pic.height)).key : cur.template,
          data: { ...cur.data, imageUrl: url, imagePublicId: publicId || null, crop: DEFAULT_CROP },
        };
      });
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

  // ---- Importing a template ----
  const readImport = async (file) => {
    if (!file) return;
    setImporting({ busy: true, fileName: file.name });
    try {
      if (file.size > MAX_TEMPLATE_BYTES) throw new Error('That SVG is larger than 8 MB. Make its pictures smaller and try again.');
      if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') throw new Error('Choose an .svg file.');
      const doc = parseSvg(await file.text());
      const report = sanitizeSvgDocument(doc);
      let info = analyzeTemplate(doc);
      // An older template (Photo-...-REPLACE-ME, Headline-Line-1 ...) is
      // brought up to the contract first.
      let converted = null;
      if (contractProblems(info).length && isLegacyTemplate(doc)) {
        converted = convertLegacyTemplate(doc, measure).notes;
        info = analyzeTemplate(doc);
      }
      const problems = contractProblems(info);
      if (problems.length) {
        throw new Error(`This SVG cannot be used as a poster template: ${problems.join('; ')}. Name the photo layer "photo" (an <image>) and the headline "headline" (a <text>), or use one of the older JSCI templates.`);
      }
      const svg = new XMLSerializer().serializeToString(doc);
      const prepared = await prepareTemplate(svg);
      const c = await rasterize(rawTemplateSvg(prepared, fontCss || ''), 300, (300 * info.height) / info.width);
      const guess = doc.documentElement.getAttribute('data-template') || file.name.replace(/\.svg$/i, '');
      setImporting({ svg, info, report, converted, prepared, thumbnail: c.toDataURL('image/jpeg', 0.82), name: prettyName(guess), key: slugify(guess), fileName: file.name });
    } catch (err) {
      setImporting({ error: err.message, fileName: file.name });
    }
  };

  const saveImport = async () => {
    const im = importing;
    if (!im?.svg || !im.name.trim()) return;
    setImporting({ ...im, saving: true });
    try {
      const body = JSON.stringify({ actorId: user.id, name: im.name.trim(), key: im.key, svg: im.svg, thumbnail: im.thumbnail });
      let payload = body;
      let headers = { 'Content-Type': 'application/json' };
      if (body.length > 400000 && typeof CompressionStream !== 'undefined') {
        payload = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        headers = { 'Content-Type': 'application/octet-stream', 'x-body-encoding': 'gzip' };
      }
      const res = await fetch('/api/news/poster-templates', { method: 'POST', headers, body: payload });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'The template could not be saved.');
      const row = json.data;
      tplCache.current.set(row.key, Promise.resolve(im.prepared));
      setTemplates((list) => [...list.filter((t) => t.key !== row.key), row]);
      setImporting(null);
      setPoster((p) => ({ ...p, template: row.key, data: { ...p.data, templateLocked: true } }));
      notify('ok', `"${row.name}" imported. Every control works on it.`);
    } catch (err) {
      setImporting({ ...im, saving: false, error: err.message });
    }
  };

  const removeTemplate = async (row) => {
    if (!window.confirm(`Remove the template "${row.name}" from the list? Posters already made with it still open.`)) return;
    try {
      const res = await fetch('/api/news/poster-templates', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: user.id, key: row.key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not remove it.');
      setTemplates((list) => list.filter((t) => t.key !== row.key));
      notify('ok', `"${row.name}" removed from the list.`);
    } catch (err) {
      notify('error', err.message);
    }
  };

  const saveTemplateDefault = async () => {
    if (!tpl) return;
    setBusyKey('tdefault', true);
    try {
      const res = await fetch('/api/news/poster-templates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: user.id, key: tpl.key, defaults: style }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.message || 'Could not save the template default.');
      setTemplates((list) => list.map((t) => (t.key === json.data.key ? { ...t, defaults: json.data.defaults } : t)));
      notify('ok', `New posters with "${templateRow?.name || 'this template'}" will start with these styles.`);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('tdefault', false);
    }
  };

  // ---- Logos ----
  const setLogoItems = (items) => setStyleGroup('logos', { items: items.slice(0, MAX_LOGOS) });
  const addLogo = async (file, replaceAt = null) => {
    if (!file) return;
    setBusyKey('logo', true);
    try {
      const up = await uploadPosterLogo(file, user.id);
      const pic = await inlineImage(sizedImageUrl(up.url, LOGO_SIZE.preview, { png: true }));
      setLogoAssets((m) => new Map(m).set(up.url, pic));
      const item = { url: up.url, publicId: up.publicId, width: pic.width, height: pic.height };
      const list = [...logoItems];
      if (replaceAt !== null) list[replaceAt] = item; else list.push(item);
      setLogoItems(list);
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('logo', false);
    }
  };
  const moveLogo = (from, to) => {
    if (to < 0 || to >= logoItems.length || from === to) return;
    const list = [...logoItems];
    const [it] = list.splice(from, 1);
    list.splice(to, 0, it);
    setLogoItems(list);
  };

  // A soft shadow over a bright background, a soft glow over a dark one -
  // measured from the poster behind the logos.
  const autoFitLogos = async () => {
    if (!tpl || !tpl.info.logo) return;
    setBusyKey('autofit', true);
    try {
      const s = 0.25;
      const { svg } = buildPosterSvg(tpl, poster.data, style, { ...envRef.current, hideLogos: true, scale: s });
      const c = await rasterize(svg, tpl.info.width * s, tpl.info.height * s);
      const lum = averageLuminance(c, layoutRef.current?.logoBox || tpl.info.logo.area, tpl.info.width);
      if (lum > 0.58) {
        setStyleGroup('logos', { shadow: { mode: 'soft', color: '#000000', blur: 8, opacity: Math.round(clamp(30 + (lum - 0.58) * 60, 30, 50)) }, glow: { on: false } });
        notify('ok', 'Bright behind the logos: a soft dark shadow was added.');
      } else if (lum < 0.4) {
        setStyleGroup('logos', { shadow: { mode: 'none' }, glow: { on: true, color: '#FFFFFF', strength: Math.round(clamp(40 + (0.4 - lum) * 60, 40, 65)) } });
        notify('ok', 'Dark behind the logos: a soft white glow was added.');
      } else {
        setStyleGroup('logos', { shadow: { mode: 'soft', color: '#000000', blur: 6, opacity: 25 }, glow: { on: true, color: '#FFFFFF', strength: 30 } });
        notify('ok', 'Medium brightness behind the logos: a light shadow and a faint glow were added.');
      }
    } catch (err) {
      notify('error', err.message);
    } finally {
      setBusyKey('autofit', false);
    }
  };

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
        if (d.subtext) { patch.subtext = d.subtext; patch.showSubtext = true; patch.subtextHighlights = []; }
        return { ...cur, data: { ...cur.data, ...patch } };
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
  const api = async (method, body) => {
    const res = await fetch('/api/news/posters', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: user.id, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success) throw new Error(json.message || 'Something went wrong. Please try again.');
    return json.data;
  };

  const thumbnail = async () => {
    try {
      const s = 180 / tpl.info.width;
      const { svg } = buildPosterSvg(tpl, poster.data, style, { ...envRef.current, scale: s });
      const c = await rasterize(svg, 180, tpl.info.height * s);
      return c.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  };

  const save = async () => {
    if (setupNote) { notify('error', setupNote); return; }
    if (busy.save || !tpl) return;
    const sent = poster;
    setBusyKey('save', true);
    try {
      const fields = { name: sent.name, template_key: sent.template, data: sent.data, preview_url: await thumbnail() };
      const row = sent.id ? await api('PUT', { id: sent.id, poster: fields }) : await api('POST', { articleId, poster: fields });
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
    if (poster?.id === row.id) { setTab('content'); return; }
    if (changed && !window.confirm('This poster has changes that are not saved. Open the other one anyway?')) return;
    const next = fromRow(row);
    liveCrop.current = null;
    setPoster(next);
    setSavedSnap(snapOf(next));
    setTab('content');
  };

  const newPoster = async () => {
    if (changed && !window.confirm('This poster has changes that are not saved. Start a new one anyway?')) return;
    const next = await freshPoster(article, images, defaults, posters.length);
    liveCrop.current = null;
    setPoster(next);
    setSavedSnap(snapOf(next));
    setTab('content');
  };

  const duplicate = async (row) => {
    setBusyKey(`v-${row.id}`, true);
    try {
      const copy = await api('POST', { articleId, poster: { name: `${row.name} copy`.slice(0, 60), template_key: row.template_key, data: row.data, preview_url: row.preview_url } });
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
  // The same drawing at full size: the photo and logos at a higher
  // resolution, the fonts embedded, 1x or 2x.
  const download = async (type) => {
    setBusyKey('download', true);
    try {
      const s = scale;
      const env = { ...envRef.current, scale: s };
      if (poster.data.imageUrl) env.photo = await inlineImage(sizedImageUrl(poster.data.imageUrl, s === 2 ? 2400 : 1600));
      const sharper = new Map(envRef.current.logos);
      await Promise.all(logoItems.filter((it) => it.url).map(async (it) => {
        const pic = await inlineImage(sizedImageUrl(it.url, LOGO_SIZE.export, { png: true })).catch(() => null);
        if (pic) sharper.set(it.url, pic);
      }));
      env.logos = sharper;
      const { svg } = buildPosterSvg(tpl, poster.data, style, env);
      const c = await rasterize(svg, tpl.info.width * s, tpl.info.height * s);
      const blob = await canvasBlob(c, type === 'png' ? 'image/png' : 'image/jpeg', 0.92);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `poster-${article.slug || 'news'}-${tpl.key}-${today()}${s === 2 ? '-2x' : ''}.${type === 'png' ? 'png' : 'jpg'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notify('ok', `Downloaded: ${c.width} × ${c.height} ${type.toUpperCase()}.`);
    } catch (err) {
      notify('error', err?.name === 'SecurityError' ? 'The browser would not let this poster be saved. Try another photo or browser.' : err.message);
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

  // ---- What the controls show: the template's own values, its saved
  // defaults, then this poster's choices ----
  const info = tpl.info;
  const d = poster.data;
  const base = {
    text: {
      headlineColor: info.headline?.color || '#FFFFFF',
      subtextColor: info.subtext?.color || '#FFFFFF',
      subtextHighlightColor: '#FFE066',
      creditColor: info.credit?.color || '#FFFFFF',
      footerColor: info.footer?.color || '#FFFFFF',
    },
    overlay: { on: Boolean(info.overlay), height: clamp(info.overlay?.height || 50, 20, 80), color: info.overlay?.color || '#000000', strength: 100 },
    topShade: { on: Boolean(info.topShade), height: clamp(info.topShade?.height || 30, 0, 50), color: info.topShade?.color || '#000000', strength: 60 },
    background: { top: info.background?.top || '#FFFFFF', bottom: info.background?.bottom || '#000000' },
    filters: { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0, vignette: false, vignetteStrength: 50, applyToCopies: false },
    logos: {
      divider: true,
      shadow: { mode: info.logo?.filter ? 'template' : 'none', color: '#000000', blur: 8, opacity: 35 },
      glow: { on: Boolean(info.logoGlow), color: info.logoGlow?.color || '#FFFFFF', strength: info.logoGlow ? 100 : 60 },
    },
  };
  const E = mergeStyle(base, style);
  const hlChoice = E.text.highlight?.kind === 'solid' ? 'solid' : E.text.highlight?.kind === 'preset' ? E.text.highlight.preset : info.headline?.preset || 'template';
  const zoomPct = Math.round((d.crop?.zoom || 1) * 100);
  const footerChanged = defaults && (d.website !== defaults.website || d.facebook !== defaults.facebook);
  const status = !poster.id ? 'Not saved yet' : changed ? 'Unsaved changes' : 'Saved';
  const aiBusy = Object.keys(busy).some((k) => k.startsWith('ai-') && busy[k]);
  const subtextOn = Boolean(info.subtext) && d.showSubtext;
  const logoThumb = (it) => (it.url ? sizedImageUrl(it.url, 160, { png: true }) : info.logo?.images[it.template]?.href || '');
  const shadowModes = [
    ...(info.logo?.filter ? [{ value: 'template', label: 'Template' }] : []),
    { value: 'none', label: 'None' }, { value: 'soft', label: 'Soft' }, { value: 'strong', label: 'Strong' },
  ];
  const capList = importing?.info ? [
    ['Photo', Boolean(importing.info.photo)],
    ['Headline', Boolean(importing.info.headline)],
    ['Subtext', Boolean(importing.info.subtext)],
    ['Logo', Boolean(importing.info.logo)],
    ['Background gradient', Boolean(importing.info.background)],
    ['Bottom gradient', Boolean(importing.info.overlay)],
    ['Top gradient', importing.info.topShade ? true : 'added'],
    ['Divider', importing.info.divider],
    ['Text anchored', Boolean(importing.info.textBlock)],
    ['Photo credit', Boolean(importing.info.credit)],
    ['Footer', Boolean(importing.info.footer)],
  ] : [];

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
              <button type="button" className={scale === 1 ? 'on' : ''} onClick={() => setScale(1)} title={`${dims.w} × ${dims.h}`}>1×</button>
              <button type="button" className={scale === 2 ? 'on' : ''} onClick={() => setScale(2)} title={`${dims.w * 2} × ${dims.h * 2}, sharper on Facebook`}>2×</button>
            </div>
            <button type="button" disabled={busy.download} onClick={() => download('png')}>{busy.download ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-download"></i>} PNG</button>
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
              width={dims.w}
              height={dims.h}
              style={{ aspectRatio: `${dims.w} / ${dims.h}`, width: `min(100%, calc((100vh - 150px) * ${dims.w} / ${dims.h}))` }}
              aria-label="Poster preview"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={(e) => { if (inFrame(toPoster(e))) fitPhoto(); }}
            />
            {(photoState === 'loading' || busy.photo || busy.upload || busy.template) && (
              <div className="pe-canvas-busy"><i className="fas fa-spinner fa-spin"></i> {busy.upload ? 'Uploading the photo…' : busy.template ? 'Opening the template…' : 'Loading the photo…'}</div>
            )}
          </div>
          <p className="pe-hint">
            <i className="fas fa-hand"></i> Drag the photo to move it · scroll or pinch to zoom · double-click to fit · click a word to highlight it
          </p>
        </main>

        {/* ---- Controls ---- */}
        <aside className="pe-panel">
          <div className="pe-tabs three" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'content'} className={tab === 'content' ? 'on' : ''} onClick={() => setTab('content')}>
              <i className="fas fa-pen-nib"></i> Content
            </button>
            <button type="button" role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}>
              <i className="fas fa-palette"></i> Style
            </button>
            <button type="button" role="tab" aria-selected={tab === 'versions'} className={tab === 'versions' ? 'on' : ''} onClick={() => setTab('versions')}>
              <i className="fas fa-layer-group"></i> Versions <span className="pe-count">{posters.length}</span>
            </button>
          </div>

          <div className="pe-scroll">
            {setupNote && <p className="pe-note"><i className="fas fa-database"></i> {setupNote}</p>}

            {tab === 'content' && (
              <>
                <section className="pe-sec">
                  <h3>Template</h3>
                  <div className="pe-templates">
                    {templates.map((t) => (
                      <div key={t.key} className={`pe-template ${poster.template === t.key ? 'on' : ''}`}>
                        <button type="button" onClick={() => chooseTemplate(t.key)} aria-pressed={poster.template === t.key} disabled={busy.template}>
                          <span className="pe-template-pic" style={{ aspectRatio: `${t.width} / ${t.height}` }}>
                            {(t.thumbnail_url || thumbs[t.key]) ? <img src={t.thumbnail_url || thumbs[t.key]} alt="" /> : <i className="far fa-image"></i>}
                          </span>
                          <span className="pe-template-name">{t.name}</span>
                          <span className="pe-template-meta">{t.width} × {t.height}{t.source === 'imported' ? ' · imported' : ''}</span>
                        </button>
                        {t.source === 'imported' && (
                          <button type="button" className="pe-template-x" onClick={() => removeTemplate(t)} aria-label={`Remove ${t.name}`} title="Remove from the list"><i className="fas fa-xmark"></i></button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="pe-template pe-import" onClick={() => importInput.current?.click()}>
                      <i className="fas fa-file-import"></i>
                      <span>Import template (.svg)</span>
                    </button>
                    <input ref={importInput} type="file" accept=".svg,image/svg+xml" hidden onChange={(e) => { readImport(e.target.files?.[0]); e.target.value = ''; }} />
                  </div>
                  {templateNote && <p className="pe-small"><i className="fas fa-circle-info"></i> {templateNote}</p>}

                  {importing && (
                    <div className="pe-import-box">
                      <div className="pe-import-head">
                        <strong><i className="fas fa-file-import"></i> {importing.fileName || 'Template'}</strong>
                        <button type="button" onClick={() => setImporting(null)} aria-label="Close"><i className="fas fa-xmark"></i></button>
                      </div>
                      {importing.busy && <p className="pe-small"><i className="fas fa-spinner fa-spin"></i> Checking the file…</p>}
                      {importing.error && <p className="pe-warn"><i className="fas fa-triangle-exclamation"></i> {importing.error}</p>}
                      {importing.info && (
                        <>
                          <div className="pe-import-body">
                            <img src={importing.thumbnail} alt="" />
                            <ul className="pe-caps">
                              {capList.map(([label, ok]) => (
                                <li key={label} className={ok === true ? 'ok' : ok === 'added' ? 'add' : 'no'}>
                                  <i className={`fas ${ok === true ? 'fa-check' : ok === 'added' ? 'fa-plus' : 'fa-minus'}`}></i>
                                  {label}{ok === 'added' ? ' — will be added' : ''}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <p className="pe-small">
                            {importing.info.width} × {importing.info.height}.
                            {(importing.report.elements + importing.report.attributes) > 0 && ` Removed for safety: ${importing.report.elements} element(s), ${importing.report.attributes} attribute(s).`}
                            {importing.report.imports > 0 && ' The font link was removed; the app supplies Outfit and Poppins.'}
                          </p>
                          {importing.converted && (
                            <p className="pe-convert">
                              <i className="fas fa-wand-magic-sparkles"></i> Converted from the older template layout: {importing.converted.join(', ')}.
                            </p>
                          )}
                          <label className="pe-field">
                            <span>Name</span>
                            <input className="pe-input" value={importing.name} maxLength={60} onChange={(e) => setImporting({ ...importing, name: e.target.value })} />
                          </label>
                          <div className="pe-btnrow">
                            <button type="button" className="pe-save small" disabled={importing.saving || !importing.name.trim()} onClick={saveImport}>
                              {importing.saving ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check"></i>} Save template
                            </button>
                            <button type="button" className="pe-soft" onClick={() => setImporting(null)}>Cancel</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
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
                    <p className="pe-warn"><i className="fas fa-triangle-exclamation"></i> The text is longer than the template&rsquo;s lines allow. Shorten it or make it smaller (Style).</p>
                  )}
                  <div className="pe-sec-head sub">
                    <span>Highlighted words <small>click to turn on or off</small></span>
                    <button type="button" className="pe-regen" disabled={aiBusy || !d.headline.trim()} onClick={() => runAi('highlight')}>
                      {busy['ai-highlight'] ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate"></i>} Regenerate
                    </button>
                  </div>
                  <Chips text={d.headline} phrases={d.highlights} onToggle={(i) => toggleWord('headline', i)} />
                </section>

                <section className="pe-sec">
                  <div className="pe-sec-head">
                    <h3>Subtext</h3>
                    {info.subtext
                      ? <Switch on={d.showSubtext} onChange={(on) => setData({ showSubtext: on })} label="Show the subtext" />
                      : <span className="pe-small">Not in this template</span>}
                  </div>
                  {subtextOn && (
                    <>
                      <div className="pe-row">
                        <textarea className="pe-input" rows={2} value={d.subtext} maxLength={200} placeholder="NOVEMBER 15, 2026 | MAIN SANCTUARY" onChange={(e) => setData({ subtext: e.target.value.replace(/\s*\n\s*/g, ' ') })} />
                        <button type="button" className="pe-regen icon" disabled={aiBusy} onClick={() => runAi('subtext')} title="Regenerate the subtext from the article">
                          {busy['ai-subtext'] ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-rotate"></i>}
                        </button>
                      </div>
                      <p className="pe-small">Separate facts with | . Only use facts from the article. Click words to highlight them:</p>
                      <Chips text={formatSubtext(d.subtext)} phrases={d.subtextHighlights} onToggle={(i) => toggleWord('subtext', i)} />
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
                  {photo && (
                    <>
                      <div className="pe-zoom">
                        <button type="button" onClick={() => setZoom((d.crop.zoom || 1) - 0.1)} aria-label="Zoom out" disabled={zoomPct <= 100}><i className="fas fa-minus"></i></button>
                        <input type="range" min={POSTER_ZOOM.min * 100} max={POSTER_ZOOM.max * 100} step={1} value={zoomPct} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="Zoom" />
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

                {info.credit && (
                  <section className="pe-sec">
                    <div className="pe-sec-head">
                      <h3>Photo credit</h3>
                      <Switch on={d.showCredit} onChange={(on) => setData({ showCredit: on })} label="Show the photo credit" />
                    </div>
                    {d.showCredit && <input className="pe-input" value={d.credit} maxLength={90} placeholder="PHOTO OF: NAME" onChange={(e) => setData({ credit: e.target.value })} />}
                  </section>
                )}

                {info.footer && (
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
                      {footerChanged && <button type="button" className="pe-soft" onClick={() => setData({ website: defaults.website, facebook: defaults.facebook })}>Use the default</button>}
                    </div>
                  </section>
                )}
              </>
            )}

            {tab === 'style' && (
              <>
                <div className="pe-style-head">
                  <span>Styles for <strong>{templateRow?.name || tpl.key}</strong></span>
                  <button type="button" className="pe-soft" disabled={busy.tdefault} onClick={saveTemplateDefault} title="New posters with this template start with these styles">
                    {busy.tdefault ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-thumbtack"></i>} Set as template default
                  </button>
                </div>

                <Group title="Text" icon="fas fa-font" open onReset={() => resetGroup('text')}>
                  <div className="pe-sub-head">
                    <span>Headline size</span>
                    <label className="pe-inline"><Switch on={E.text.headlineSize === undefined} onChange={(on) => setStyleGroup('text', { headlineSize: on ? undefined : (textInfo.headlineSize || info.headline?.size || 64) })} label="Automatic headline size" /> Auto</label>
                  </div>
                  <Range
                    label="Size"
                    min={40}
                    max={110}
                    value={E.text.headlineSize ?? textInfo.headlineSize ?? info.headline?.size ?? 64}
                    disabled={E.text.headlineSize === undefined}
                    unit="px"
                    onChange={(v) => setStyleGroup('text', { headlineSize: v })}
                  />
                  {info.subtext && (
                    <Range label="Subtext size" min={18} max={48} value={E.text.subtextSize ?? textInfo.subtextSize ?? info.subtext.size} unit="px" onChange={(v) => setStyleGroup('text', { subtextSize: v })} />
                  )}
                  <ColorField label="Headline colour" value={E.text.headlineColor} onChange={(c) => setStyleGroup('text', { headlineColor: c })} />
                  <div className="pe-field">
                    <span>Highlight</span>
                    <Seg
                      label="Highlight colour"
                      value={hlChoice}
                      options={[
                        ...(info.headline?.preset ? [] : [{ value: 'template', label: 'Template' }]),
                        ...Object.entries(HIGHLIGHT_PRESETS).map(([k, v]) => ({ value: k, label: v.label })),
                        { value: 'solid', label: 'Solid' },
                      ]}
                      onChange={(v) => setStyleGroup('text', {
                        highlight: v === 'template' ? undefined : v === 'solid' ? { kind: 'solid', color: E.text.highlight?.color || '#FFD25C' } : { kind: 'preset', preset: v },
                      })}
                    />
                  </div>
                  {hlChoice === 'solid' && <ColorField label="Highlight colour" value={E.text.highlight?.color || '#FFD25C'} onChange={(c) => setStyleGroup('text', { highlight: { kind: 'solid', color: c } })} />}
                  {info.subtext && <ColorField label="Subtext colour" value={E.text.subtextColor} onChange={(c) => setStyleGroup('text', { subtextColor: c })} />}
                  {info.subtext && <ColorField label="Subtext highlight" value={E.text.subtextHighlightColor} onChange={(c) => setStyleGroup('text', { subtextHighlightColor: c })} />}
                  {info.credit && <ColorField label="Photo credit colour" value={E.text.creditColor} onChange={(c) => setStyleGroup('text', { creditColor: c })} />}
                  {info.footer && <ColorField label="Footer colour" value={E.text.footerColor} onChange={(c) => setStyleGroup('text', { footerColor: c })} />}
                </Group>

                <Group title="Gradients" icon="fas fa-fill-drip" onReset={() => { resetGroup('overlay'); resetGroup('topShade'); resetGroup('background'); }}>
                  {info.overlay && (
                    <div className="pe-block">
                      <div className="pe-sub-head"><span>Bottom gradient</span><Switch on={E.overlay.on} onChange={(on) => setStyleGroup('overlay', { on })} label="Bottom gradient" /></div>
                      {E.overlay.on && (
                        <>
                          <Range label="Height" min={20} max={80} unit="%" value={E.overlay.height} onChange={(v) => setStyleGroup('overlay', { height: v })} />
                          <ColorField label="Colour" value={E.overlay.color} onChange={(c) => setStyleGroup('overlay', { color: c })} />
                          <Range label="Strength" min={0} max={100} unit="%" value={E.overlay.strength} onChange={(v) => setStyleGroup('overlay', { strength: v })} />
                        </>
                      )}
                    </div>
                  )}
                  <div className="pe-block">
                    <div className="pe-sub-head"><span>Top gradient</span><Switch on={E.topShade.on} onChange={(on) => setStyleGroup('topShade', { on })} label="Top gradient" /></div>
                    {E.topShade.on && (
                      <>
                        <Range label="Height" min={0} max={50} unit="%" value={E.topShade.height} onChange={(v) => setStyleGroup('topShade', { height: v })} />
                        <ColorField label="Colour" value={E.topShade.color} onChange={(c) => setStyleGroup('topShade', { color: c })} />
                        <Range label="Strength" min={0} max={100} unit="%" value={E.topShade.strength} onChange={(v) => setStyleGroup('topShade', { strength: v })} />
                      </>
                    )}
                  </div>
                  {info.background && (
                    <div className="pe-block">
                      <div className="pe-sub-head"><span>Background gradient</span></div>
                      <ColorField label="Top colour" value={E.background.top} onChange={(c) => setStyleGroup('background', { top: c })} />
                      <ColorField label="Bottom colour" value={E.background.bottom} onChange={(c) => setStyleGroup('background', { bottom: c })} />
                    </div>
                  )}
                </Group>

                <Group title="Photo filters" icon="fas fa-sliders" onReset={() => resetGroup('filters')}>
                  {!photo && <p className="pe-small">Choose a photo to use the filters.</p>}
                  <Range label="Brightness" min={50} max={150} unit="%" value={E.filters.brightness} onChange={(v) => setStyleGroup('filters', { brightness: v })} />
                  <Range label="Contrast" min={50} max={150} unit="%" value={E.filters.contrast} onChange={(v) => setStyleGroup('filters', { contrast: v })} />
                  <Range label="Saturation" min={0} max={200} unit="%" value={E.filters.saturation} onChange={(v) => setStyleGroup('filters', { saturation: v })} />
                  <Range label="Warmth" min={0} max={100} unit="%" value={E.filters.warmth} onChange={(v) => setStyleGroup('filters', { warmth: v })} />
                  <Range label="Blur" min={0} max={20} unit="px" value={E.filters.blur} onChange={(v) => setStyleGroup('filters', { blur: v })} />
                  <div className="pe-sub-head"><span>Vignette</span><Switch on={E.filters.vignette} onChange={(on) => setStyleGroup('filters', { vignette: on })} label="Vignette" /></div>
                  {E.filters.vignette && <Range label="Strength" min={0} max={100} unit="%" value={E.filters.vignetteStrength} onChange={(v) => setStyleGroup('filters', { vignetteStrength: v })} />}
                  {info.photoCopies > 0 && (
                    <div className="pe-sub-head"><span>Apply to background copies too</span><Switch on={E.filters.applyToCopies} onChange={(on) => setStyleGroup('filters', { applyToCopies: on })} label="Apply the filters to the background copies of the photo" /></div>
                  )}
                </Group>

                {info.logo && (
                  <Group title="Logos" icon="fas fa-certificate" onReset={() => resetGroup('logos')}>
                    <ul className="pe-logos">
                      {logoItems.map((it, i) => (
                        <li
                          key={`${it.url || `t${it.template}`}-${i}`}
                          draggable
                          className={dragLogo === i ? 'dragging' : ''}
                          onDragStart={() => setDragLogo(i)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => { moveLogo(dragLogo, i); setDragLogo(null); }}
                          onDragEnd={() => setDragLogo(null)}
                        >
                          <i className="fas fa-grip-vertical pe-grip" aria-hidden="true"></i>
                          <span className="pe-logo-pic">{logoThumb(it) ? <img src={logoThumb(it)} alt="" /> : <i className="far fa-image"></i>}</span>
                          <span className="pe-logo-name">{it.url ? 'Uploaded logo' : 'Template logo'}</span>
                          <span className="pe-logo-actions">
                            <button type="button" onClick={() => moveLogo(i, i - 1)} disabled={i === 0} aria-label="Move left"><i className="fas fa-arrow-up"></i></button>
                            <button type="button" onClick={() => moveLogo(i, i + 1)} disabled={i === logoItems.length - 1} aria-label="Move right"><i className="fas fa-arrow-down"></i></button>
                            <label className="pe-logo-btn" title="Replace">
                              <input type="file" accept="image/png,image/svg+xml,image/webp" hidden onChange={(e) => { addLogo(e.target.files?.[0], i); e.target.value = ''; }} />
                              <i className="fas fa-arrows-rotate"></i>
                            </label>
                            <button type="button" onClick={() => setLogoItems(logoItems.filter((_, k) => k !== i))} aria-label="Remove" className="danger"><i className="fas fa-trash"></i></button>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {logoItems.length < MAX_LOGOS && (
                      <label className={`pe-soft pe-add-logo ${busy.logo ? 'busy' : ''}`}>
                        <input type="file" accept="image/png,image/svg+xml,image/webp" hidden disabled={busy.logo} onChange={(e) => { addLogo(e.target.files?.[0]); e.target.value = ''; }} />
                        {busy.logo ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-plus"></i>} Add logo <small>(transparent PNG or SVG, up to 2 MB)</small>
                      </label>
                    )}
                    {logoItems.length > 1 && (
                      <div className="pe-sub-head"><span>Thin line between logos</span><Switch on={E.logos.divider !== false} onChange={(on) => setStyleGroup('logos', { divider: on })} label="Line between logos" /></div>
                    )}
                    <div className="pe-field">
                      <span>Shadow</span>
                      <Seg
                        label="Logo shadow"
                        value={E.logos.shadow.mode}
                        options={shadowModes}
                        onChange={(mode) => setStyleGroup('logos', {
                          shadow: mode === 'template' ? undefined : { ...(style.logos?.shadow || {}), mode, ...(mode === 'soft' ? { blur: 8, opacity: 35 } : mode === 'strong' ? { blur: 14, opacity: 65 } : {}) },
                        })}
                      />
                    </div>
                    {(E.logos.shadow.mode === 'soft' || E.logos.shadow.mode === 'strong') && (
                      <>
                        <ColorField label="Shadow colour" value={E.logos.shadow.color} onChange={(c) => setStyleGroup('logos', { shadow: { ...E.logos.shadow, color: c } })} />
                        <Range label="Blur" min={0} max={20} value={E.logos.shadow.blur} onChange={(v) => setStyleGroup('logos', { shadow: { ...E.logos.shadow, blur: v } })} />
                        <Range label="Opacity" min={0} max={100} unit="%" value={E.logos.shadow.opacity} onChange={(v) => setStyleGroup('logos', { shadow: { ...E.logos.shadow, opacity: v } })} />
                      </>
                    )}
                    <div className="pe-sub-head"><span>Glow behind the logos</span><Switch on={E.logos.glow.on} onChange={(on) => setStyleGroup('logos', { glow: { ...(style.logos?.glow || {}), on } })} label="Glow behind the logos" /></div>
                    {E.logos.glow.on && (
                      <>
                        <ColorField label="Glow colour" value={E.logos.glow.color} onChange={(c) => setStyleGroup('logos', { glow: { ...(style.logos?.glow || {}), on: true, color: c } })} />
                        <Range label="Strength" min={0} max={100} unit="%" value={E.logos.glow.strength} onChange={(v) => setStyleGroup('logos', { glow: { ...(style.logos?.glow || {}), on: true, strength: v } })} />
                      </>
                    )}
                    <div className="pe-btnrow">
                      <button type="button" className="pe-soft" disabled={busy.autofit} onClick={autoFitLogos} title="Look at the photo behind the logos and pick a subtle shadow or glow">
                        {busy.autofit ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-wand-magic-sparkles"></i>} Auto-fit to photo
                      </button>
                    </div>
                  </Group>
                )}
              </>
            )}

            {tab === 'versions' && (
              <section className="pe-sec">
                <button type="button" className="pe-new" onClick={newPoster}><i className="fas fa-plus"></i> New poster from the article</button>
                {!posters.length && <p className="pe-empty">No saved versions yet. Press <strong>Save version</strong> to keep this poster.</p>}
                <ul className="pe-versions">
                  {posters.map((row) => {
                    const current = poster.id === row.id;
                    const rowKey = resolveTemplateKey(row.template_key, {}).key;
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
                          <span>{templates.find((t) => t.key === rowKey)?.name || rowKey} · {timeAgo(row.updated_at)}</span>
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
