// Joy's knowledge: documents a Super Admin gives the public chatbot.
//
// A file is read to plain text once, when it is uploaded, and cut into short
// sections (supabase/migrations/joy_knowledge.sql). When a visitor asks Joy
// something, the sections that best match the question are found here and put
// in front of the AI with it - so she answers from the church's own words
// rather than guessing, and only the few sections that matter are sent, not
// whole documents.
//
// Search is plain word matching (BM25), done in memory. A church has tens of
// documents, not millions, and this needs no embeddings service, no extra API
// key and no database extension - and it treats Tagalog and Cebuano words the
// same as English ones, which an English full-text index would not.
//
// SERVER ONLY: it reads with the service-role client.

import JSZip from 'jszip';
import { supabaseAdmin } from '@/lib/supabase';
import { linkPlatform, linkTitle, parseLink } from '@/lib/linkMeta';

export const KNOWLEDGE_DOCS = 'joy_knowledge_docs';
export const KNOWLEDGE_CHUNKS = 'joy_knowledge_chunks';

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel takes 4.5 MB per request
export const MAX_DOC_CHARS = 1_000_000;
export const ACCEPTED_TYPES = ['pdf', 'docx', 'txt', 'md', 'csv'];
const CHUNK_TARGET = 1100; // characters per section

// ---- Reading a file ----------------------------------------------------------

const extOf = (name) => String(name || '').toLowerCase().split('.').pop();

async function pdfText(buffer) {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
    }).promise;
  } catch (err) {
    if (/password/i.test(err?.message || '')) throw new Error('That PDF is password-protected. Save a copy without the password and upload that.');
    throw new Error('That PDF could not be read.');
  }
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let text = '';
    for (const it of items) {
      text += it.str || '';
      text += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : '');
    }
    pages.push(text);
  }
  await doc.destroy();
  return pages.join('\n\n');
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e]);

async function docxText(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('That Word file could not be opened. Save it again as .docx and upload that.');
  }
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('That does not look like a Word (.docx) document.');
  const xml = await file.async('string');
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, ''),
  );
}

// Tidy whatever came out: one space between words, no trailing spaces, no more
// than one blank line in a row.
export const normalizeText = (text) => String(text || '')
  .replace(/^﻿/, '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t ]+/g, ' ')
  .split('\n').map((l) => l.trim()).join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export async function extractText(buffer, fileName) {
  const type = extOf(fileName);
  if (!ACCEPTED_TYPES.includes(type)) {
    throw new Error('Joy can read PDF, Word (.docx), text (.txt), Markdown (.md) and CSV files. Save the file as one of those and try again.');
  }
  let raw;
  if (type === 'pdf') raw = await pdfText(buffer);
  else if (type === 'docx') raw = await docxText(buffer);
  else raw = Buffer.from(buffer).toString('utf8');
  const text = normalizeText(raw);
  if (text.replace(/\s/g, '').length < 20) {
    throw new Error(type === 'pdf'
      ? 'This PDF has no text Joy can read - it may be scanned pictures of pages. Use a PDF with selectable text, or paste the text as a note.'
      : 'This file has no text in it.');
  }
  if (text.length > MAX_DOC_CHARS) {
    throw new Error(`This document is too long (${text.length.toLocaleString()} characters). Split it into smaller files of under ${MAX_DOC_CHARS.toLocaleString()} characters.`);
  }
  return { text, type };
}

// ---- Cutting it into sections -------------------------------------------------

// Paragraph by paragraph up to about CHUNK_TARGET characters, so a section is
// a few related paragraphs rather than half of one. A paragraph that is too
// long on its own (PDFs often have no blank lines at all) goes sentence by
// sentence instead.
export function chunkText(text) {
  const paras = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
  for (const p of paras) {
    if (p.length > CHUNK_TARGET * 1.5) {
      const sentences = p.match(/[^.!?\n]+(?:[.!?]+|\n|$)\s*/g) || [p];
      for (const s of sentences) {
        if (cur && cur.length + s.length > CHUNK_TARGET) push();
        cur += s;
        while (cur.length > CHUNK_TARGET * 1.5) {
          chunks.push(cur.slice(0, CHUNK_TARGET).trim());
          cur = cur.slice(CHUNK_TARGET);
        }
      }
      continue;
    }
    if (cur && cur.length + p.length + 2 > CHUNK_TARGET) push();
    cur += (cur ? '\n\n' : '') + p;
  }
  push();
  return chunks;
}

// ---- Finding the sections that answer a question ---------------------------

// Words that say nothing about WHAT is being asked, in English, Tagalog and
// Cebuano - the languages Joy's visitors write in.
const STOP = new Set(`
a an the is are was were be been being am to of in on at for and or but nor with by from as into onto about above
it its this that these those there here what whats when where who whom whose which why how do does did done can
could would should will shall may might must i im me my mine we our ours us you your yours he him his she her hers
they them their theirs if so than then just also too very any some all each every more most much many such only own
same not no yes ok okay please pls tell know want like get give got have has had having let lets make need show see
one two thing things something anything hi hello hey thanks thank good morning afternoon evening joy
po ba ang ng sa mga ko mo na si ni kay ito iyan yan yung iyong ano paano kailan saan sino bakit pwede puwede gusto
ug og nga unsa unsaon kanus kanusa asa kinsa ngano ako ikaw siya kami kita sila naa wala diha dinhi kini kana
`.split(/\s+/).filter(Boolean));

const stem = (w) => {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
};

export const tokenize = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/)
  .filter((w) => w && (w.length > 1 || /\d/.test(w)) && !STOP.has(w))
  .map(stem);

const INDEX_TTL_MS = 60 * 1000;
let indexCache = { at: 0, index: null };

// Forget the index on this server, after an upload, a delete or a switch.
// Other servers catch up within INDEX_TTL_MS.
export const forgetKnowledgeIndex = () => { indexCache = { at: 0, index: null }; };

async function loadIndex() {
  if (indexCache.index && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.index;

  // The url column came in a later version of the migration; a database
  // without it still serves its documents, just no links.
  let { data: docs, error } = await supabaseAdmin
    .from(KNOWLEDGE_DOCS).select('id, title, file_type, url').eq('is_active', true);
  if (error && /url/.test(error.message || '')) {
    ({ data: docs, error } = await supabaseAdmin
      .from(KNOWLEDGE_DOCS).select('id, title, file_type').eq('is_active', true));
  }
  if (error) throw error;

  // Links are not searched: there are only ever a handful, and Joy is given
  // all of them every time (see knowledgePrompt), so "where can I watch?" finds
  // the YouTube channel even when the question shares no word with its title.
  const links = (docs || [])
    .filter((d) => d.file_type === 'link' && d.url)
    .map((d) => ({ id: d.id, title: d.title, url: d.url }));
  const titles = new Map((docs || []).filter((d) => d.file_type !== 'link').map((d) => [d.id, d.title]));
  const chunks = [];
  if (titles.size > 0) {
    const ids = [...titles.keys()];
    // PostgREST hands back at most 1000 rows a request.
    for (let from = 0; ; from += 1000) {
      const { data, error: err } = await supabaseAdmin
        .from(KNOWLEDGE_CHUNKS)
        .select('id, doc_id, idx, content')
        .in('doc_id', ids)
        .order('doc_id').order('idx')
        .range(from, from + 999);
      if (err) throw err;
      chunks.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }

  const df = new Map();
  const rows = chunks.map((c) => {
    const title = titles.get(c.doc_id) || '';
    const words = tokenize(`${title} ${c.content}`);
    const tf = new Map();
    words.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1));
    return { ...c, title, tf, len: words.length || 1 };
  });
  const avgLen = rows.reduce((n, r) => n + r.len, 0) / (rows.length || 1);

  // What each link is for, written by the admin when it was added.
  if (links.length) {
    const { data: about } = await supabaseAdmin
      .from(KNOWLEDGE_CHUNKS).select('doc_id, content').in('doc_id', links.map((l) => l.id)).eq('idx', 0);
    const byId = new Map((about || []).map((c) => [c.doc_id, c.content]));
    links.forEach((l) => {
      const m = String(byId.get(l.id) || '').match(/^About: (.+)$/m);
      l.about = m ? m[1].trim() : '';
    });
  }

  const index = { rows, df, avgLen, n: rows.length, links };
  indexCache = { at: Date.now(), index };
  return index;
}

// The church's links that are switched on, for Joy's instructions.
export async function knowledgeLinks() {
  return (await loadIndex()).links;
}

// The best few sections for a question, most relevant first. `context` is the
// visitor's previous message, which counts for half: "what about the
// second one?" means little on its own.
export async function searchKnowledge(question, { context = '', max = 4, maxChars = 5000 } = {}) {
  const weights = new Map();
  tokenize(question).forEach((w) => weights.set(w, 1));
  tokenize(context).forEach((w) => { if (!weights.has(w)) weights.set(w, 0.5); });
  if (weights.size === 0) return [];

  const index = await loadIndex();
  if (index.n === 0) return [];

  const k1 = 1.2;
  const b = 0.75;
  const asked = [...weights.keys()].filter((w) => weights.get(w) === 1);
  const scored = [];
  for (const row of index.rows) {
    let score = 0;
    let matched = 0;
    weights.forEach((weight, w) => {
      const f = row.tf.get(w);
      if (!f) return;
      const df = index.df.get(w) || 0;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      score += weight * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (row.len / index.avgLen))));
      if (weight === 1) matched += 1;
    });
    // Most of what was asked has to be there - one shared word ("service")
    // is not an answer to "what time is the youth service on Saturday".
    const needed = asked.length <= 2 ? 1 : Math.ceil(asked.length * 0.4);
    if (score > 0 && matched >= needed) scored.push({ row, score });
  }
  scored.sort((x, y) => y.score - x.score);

  const out = [];
  let used = 0;
  for (const { row, score } of scored) {
    if (out.length >= max) break;
    if (used + row.content.length > maxChars && out.length > 0) break;
    out.push({ id: row.id, docId: row.doc_id, title: row.title, content: row.content, score: Math.round(score * 100) / 100 });
    used += row.content.length;
  }
  return out;
}

// What goes into Joy's instructions: the church's links (always, there are
// few) and the sections that match the question (when any do).
export function knowledgePrompt(sections = [], links = []) {
  let out = '';
  if (links.length) {
    const list = links.slice(0, 25).map((l) => {
      const platform = linkPlatform(l.url);
      const kind = platform.key === 'web' ? '' : ` (${platform.name})`;
      return `- [${l.title}](${l.url})${kind}${l.about ? ` — ${l.about}` : ''}`;
    }).join('\n');
    out += `

MORE CHURCH LINKS (added by the church's administrators; you may share these exactly as written, as [Title](URL)):
${list}`;
  }
  if (sections.length) {
    const blocks = sections.map((s, i) => `[${i + 1}] From "${s.title}":\n${s.content}`).join('\n\n');
    out += `

CHURCH DOCUMENTS:
The sections below come from documents the church's administrators gave you, picked because they match the visitor's question. When they answer the question, answer from them: they are the church's own words and outrank anything you assume. Keep names, dates, times, amounts and steps exactly as written. If a section contains a web address that helps, share it as [Title](URL). If they do not answer the question, ignore them and do not guess. Do not mention "sections" or "documents" unless the visitor asks where the information comes from; then you may name the document. Never share bank or account numbers, or private information about individual members, even if a section contains them.

${blocks}`;
  }
  return out;
}

// ---- Links ------------------------------------------------------------------

// The text a link is saved as. It is searchable like any section, and the
// "About:" line is what Joy is told the link is for.
export function linkContent({ url, title, about }) {
  const platform = linkPlatform(url);
  return [
    `Link: [${title}](${url})`,
    platform.key !== 'web' ? `Platform: ${platform.name}${['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'threads', 'linkedin', 'messenger'].includes(platform.key) ? ' (social media)' : ''}` : null,
    about ? `About: ${about}` : null,
  ].filter(Boolean).join('\n');
}

// Would fetching this host reach something inside our own network? Only
// public web addresses are fetched for a title.
const privateHost = (host) => /^(localhost|.*\.local|.*\.internal)$/i.test(host)
  || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  || host === '::1' || host.startsWith('[') || !host.includes('.');

const decodeHtml = (s) => decodeXml(s.replace(/&nbsp;/g, ' ')).replace(/\s+/g, ' ').trim();

// A title for a link: the platform and account for social media ("Facebook ·
// CebuCityJoyfulSound" - their pages tell a server nothing useful), otherwise
// the page's own title, read from the first part of the page.
export async function fetchLinkTitle(raw) {
  const u = parseLink(raw);
  if (!u || !/^https?:$/.test(u.protocol)) throw new Error('That is not a web address. It should start with https://');
  const derived = linkTitle(u);
  if (linkPlatform(u).key !== 'web' || privateHost(u.hostname)) return derived;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(u.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SanctuaryHubBot/1.0)', Accept: 'text/html' },
    });
    clearTimeout(timer);
    if (!res.ok || !/text\/html/i.test(res.headers.get('content-type') || '')) return derived;
    const reader = res.body.getReader();
    let html = '';
    while (html.length < 200000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += Buffer.from(value).toString('utf8');
      if (/<\/head>/i.test(html)) break;
    }
    try { reader.cancel(); } catch { /* finished */ }
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const title = og?.[1] || html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1];
    return title ? decodeHtml(title).slice(0, 120) : derived;
  } catch {
    return derived;
  }
}

// The database's answer when the migration has not been run yet.
export const missingTable = (error) => {
  const msg = String(error?.message || error || '');
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || (/joy_knowledge_(docs|chunks)/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg));
};
export const MIGRATION_NOTE = "Joy's Knowledge needs its database tables: run supabase/migrations/joy_knowledge.sql in the Supabase SQL editor, then try again.";
