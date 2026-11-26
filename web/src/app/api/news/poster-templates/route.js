import crypto from 'crypto';
import zlib from 'zlib';
import { NextResponse } from 'next/server';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { supabaseAdmin } from '@/lib/supabase';
import { newsEditor } from '@/lib/newsServer';
import { BUILTIN_TEMPLATES, builtinTemplate } from '@/lib/posterBuiltins';
import {
  MAX_TEMPLATE_BYTES, analyzeTemplate, capabilitiesOf, contractProblems, sanitizeSvgDocument, svgSource,
} from '@/lib/posterSvgSanitize';
import { TEMPLATE_KEY, normalizeStyle } from '@/lib/posterTemplates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

// Poster templates (SVG files that follow the contract in
// lib/posterSvgSanitize.js). Admin and Super Admin only.
//
//   GET    ?actorId=                 every active template, without the SVG
//                                    (the built-ins are added / kept up to
//                                    date here)
//   GET    ?actorId=&key=            one template, with its SVG
//   POST   { actorId, name, key, svg, thumbnail }   import one. The body may
//                                    be gzipped (header x-body-encoding: gzip)
//                                    to fit an 8 MB SVG through.
//   PUT    { actorId, key, defaults } the style a template starts with
//   DELETE { actorId, key }          take an imported template off the list
//                                    (posters already made with it still open)
//
// An imported SVG is cleaned again here, whatever the browser did, and must
// have the photo and the headline.

const TABLE = 'poster_templates';
const LIST_FIELDS = 'key, name, width, height, capabilities, defaults, thumbnail_url, source, is_active, created_at, updated_at';
const SETUP_NOTE = 'To import templates and save template defaults, run supabase/migrations/poster_templates.sql in the Supabase SQL editor. The built-in templates work without it.';
const MAX_BODY = 4.4 * 1024 * 1024; // what a Vercel function accepts

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const tableMissing = (error) => {
  const msg = String(error?.message || '');
  return error?.code === '42P01' || error?.code === 'PGRST205' || (/poster_templates/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg));
};
const plain = (v, max) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

// A large answer (an 8 MB template) goes out gzipped: Vercel caps a
// function's answer at 4.5 MB.
function json(body) {
  const text = JSON.stringify(body);
  if (text.length < 3 * 1024 * 1024) return NextResponse.json(body);
  return new Response(zlib.gzipSync(text), { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } });
}

// Parse, clean and read an SVG on the server.
function readSvg(text, { clean = true } = {}) {
  let doc;
  try {
    doc = new DOMParser({ onError: () => {} }).parseFromString(svgSource(text), 'image/svg+xml');
  } catch (error) {
    throw new Error(`That SVG could not be read (${String(error.message || '').split('\n')[0].slice(0, 120)}).`);
  }
  if (!doc || !doc.documentElement) throw new Error('That SVG could not be read.');
  const report = clean ? sanitizeSvgDocument(doc) : null;
  const info = analyzeTemplate(doc);
  return { doc, info, report };
}

let builtinRowsCache = null;
function builtinRows() {
  if (!builtinRowsCache) {
    builtinRowsCache = BUILTIN_TEMPLATES.map((b) => {
      const { info } = readSvg(b.svg, { clean: false });
      return {
        key: b.key,
        name: b.name,
        svg: b.svg,
        width: Math.round(info.width),
        height: Math.round(info.height),
        capabilities: { ...capabilitiesOf(info), family: b.family, hash: crypto.createHash('sha1').update(b.svg).digest('hex') },
        source: 'builtin',
      };
    });
  }
  return builtinRowsCache;
}

const meta = ({ svg, ...rest }) => ({ defaults: {}, thumbnail_url: null, is_active: true, ...rest });

// The built-in templates, in the table and current.
async function syncBuiltins(rows) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const now = new Date().toISOString();
  await Promise.all(builtinRows().map(async (b) => {
    const row = byKey.get(b.key);
    if (!row) {
      await supabaseAdmin.from(TABLE).insert({ ...b, defaults: {}, created_at: now, updated_at: now });
    } else if (row.source !== 'builtin' || !row.is_active || row.capabilities?.hash !== b.capabilities.hash || row.name !== b.name) {
      await supabaseAdmin.from(TABLE).update({
        name: b.name, svg: b.svg, width: b.width, height: b.height, capabilities: b.capabilities, source: 'builtin', is_active: true, updated_at: now,
      }).eq('key', b.key);
    }
  }));
}

async function listTemplates() {
  const first = await supabaseAdmin.from(TABLE).select(LIST_FIELDS);
  if (first.error) {
    if (tableMissing(first.error)) return { templates: builtinRows().map(meta), setupNote: SETUP_NOTE };
    throw first.error;
  }
  await syncBuiltins(first.data || []);
  const { data, error } = await supabaseAdmin.from(TABLE).select(LIST_FIELDS).eq('is_active', true).order('created_at', { ascending: true });
  if (error) throw error;
  const order = (r) => (r.source === 'builtin' ? BUILTIN_TEMPLATES.findIndex((b) => b.key === r.key) : 100);
  return { templates: (data || []).sort((a, b) => order(a) - order(b)), setupNote: null };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const who = await newsEditor(searchParams.get('actorId'));
    if (who.error) return fail(who.error, who.status);

    const key = searchParams.get('key');
    if (key) {
      const { data, error } = await supabaseAdmin.from(TABLE).select(`${LIST_FIELDS}, svg`).eq('key', key).maybeSingle();
      if (error && !tableMissing(error)) throw error;
      if (data) return json({ success: true, data });
      const b = builtinRows().find((r) => r.key === key);
      if (b) return json({ success: true, data: { ...meta(b), svg: b.svg } });
      return fail('That template is not there any more.', 404);
    }

    return json({ success: true, data: await listTemplates() });
  } catch (error) {
    console.error('[poster templates]', error.message);
    return fail(error.message || 'Could not load the templates.', 500);
  }
}

async function readBody(request) {
  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length > MAX_BODY) throw Object.assign(new Error('That template is too large to upload. Make the pictures in it smaller (under about 4 MB once compressed).'), { status: 413 });
  let text;
  if (request.headers.get('x-body-encoding') === 'gzip') {
    try {
      text = zlib.gunzipSync(buf, { maxOutputLength: MAX_TEMPLATE_BYTES + 1024 * 1024 }).toString('utf8');
    } catch {
      throw Object.assign(new Error('That SVG is larger than 8 MB. Make its pictures smaller and try again.'), { status: 413 });
    }
  } else {
    text = buf.toString('utf8');
  }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('The upload was not readable. Please try again.'), { status: 400 }); }
}

export async function POST(request) {
  try {
    const body = await readBody(request);
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);

    const name = plain(body.name, 60);
    if (!name) return fail('Give the template a name.');
    if (typeof body.svg !== 'string' || !body.svg.trim()) return fail('Choose an SVG file.');

    let parsed;
    try { parsed = readSvg(body.svg); } catch (error) { return fail(error.message); }
    const problems = contractProblems(parsed.info);
    if (problems.length) return fail(`This SVG cannot be used as a poster template: ${problems.join('; ')}.`);
    const svg = new XMLSerializer().serializeToString(parsed.doc);

    const thumb = String(body.thumbnail || '');
    const thumbnail = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb) && thumb.length < 400000 ? thumb : null;

    // A key of its own: never a built-in's, never one already taken.
    const reserved = new Set(BUILTIN_TEMPLATES.map((b) => b.key).concat(['landscape_sub', 'portrait_sub']));
    const base = (TEMPLATE_KEY.test(String(body.key || '')) ? String(body.key) : slug(body.key || name)) || 'template';
    const { data: taken, error: takenError } = await supabaseAdmin.from(TABLE).select('key').like('key', `${base}%`);
    if (takenError) return tableMissing(takenError) ? fail(SETUP_NOTE, 503) : fail(takenError.message, 500);
    const used = new Set((taken || []).map((r) => r.key));
    let key = base;
    for (let i = 2; used.has(key) || reserved.has(key); i += 1) key = `${base}-${i}`;

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from(TABLE).insert({
      key,
      name,
      svg,
      width: Math.round(parsed.info.width),
      height: Math.round(parsed.info.height),
      capabilities: capabilitiesOf(parsed.info),
      defaults: {},
      thumbnail_url: thumbnail,
      source: 'imported',
      is_active: true,
      created_by: who.user.id,
      created_at: now,
      updated_at: now,
    }).select(LIST_FIELDS).single();
    if (error) return tableMissing(error) ? fail(SETUP_NOTE, 503) : fail(error.message, 500);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[poster templates import]', error.message);
    return fail(error.message || 'Could not import the template.', error.status || 500);
  }
}

export async function PUT(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);
    const key = String(body.key || '');
    if (!TEMPLATE_KEY.test(key)) return fail('Which template?');

    let { data: row, error } = await supabaseAdmin.from(TABLE).select('key').eq('key', key).maybeSingle();
    if (error) return tableMissing(error) ? fail(SETUP_NOTE, 503) : fail(error.message, 500);
    if (!row && builtinTemplate(key)) {
      await syncBuiltins([]);
      ({ data: row } = await supabaseAdmin.from(TABLE).select('key').eq('key', key).maybeSingle());
    }
    if (!row) return fail('That template is not there any more.', 404);

    const defaults = normalizeStyle(body.defaults);
    const { data, error: saveError } = await supabaseAdmin.from(TABLE)
      .update({ defaults, updated_at: new Date().toISOString() })
      .eq('key', key).select(LIST_FIELDS).single();
    if (saveError) throw saveError;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return fail(error.message || 'Could not save the template default.', 500);
  }
}

export async function DELETE(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);
    const key = String(body.key || '');
    if (builtinTemplate(key)) return fail('The built-in templates cannot be removed.');
    const { error } = await supabaseAdmin.from(TABLE).update({ is_active: false, updated_at: new Date().toISOString() }).eq('key', key).eq('source', 'imported');
    if (error) return tableMissing(error) ? fail(SETUP_NOTE, 503) : fail(error.message, 500);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error.message || 'Could not remove the template.', 500);
  }
}
