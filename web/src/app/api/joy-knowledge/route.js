import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  KNOWLEDGE_CHUNKS, KNOWLEDGE_DOCS, MAX_FILE_BYTES, MIGRATION_NOTE,
  chunkText, extractText, fetchLinkTitle, forgetKnowledgeIndex, linkContent, missingTable, normalizeText, searchKnowledge,
} from '@/lib/joyKnowledge';
import { parseLink } from '@/lib/linkMeta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Dashboard > System Configuration > Joy's Knowledge (Super Admin only).
//
//   GET    ?actorId=            the documents
//   GET    ?actorId=&docId=     what Joy read from one of them (the start of it)
//   GET    ?actorId=&q=         the sections Joy would be given for a question
//   GET    ?actorId=&titleFor=  a title for a link (the platform, or the page's own)
//   POST   multipart file      a PDF / Word / text file   (+ actorId, title?)
//   POST   JSON { title, text } a note typed in the dashboard
//   POST   JSON { kind: 'link', url, title?, about? }  a link Joy may share
//   PATCH  { id, is_active?, title? }
//   DELETE { id }
//
// Uploading a file with the same name as one already here replaces it, so a
// new version of the church handbook does not leave Joy reading both.

const DOC_FIELDS = 'id, title, file_name, file_type, file_size, char_count, chunk_count, is_active, uploaded_by_name, created_at, updated_at, url';
const OLD_DOC_FIELDS = DOC_FIELDS.replace(', url', '');
const URL_COLUMN_NOTE = "Links need one more column: run supabase/migrations/joy_knowledge.sql again in the Supabase SQL editor (it is safe to run twice), then try again.";
const noUrlColumn = (error) => /url/.test(error?.message || '') && /(column|schema cache)/i.test(error?.message || '');
const PREVIEW_CHARS = 6000;

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const failFrom = (error, fallback) => (missingTable(error)
  ? fail(MIGRATION_NOTE, 503)
  : fail(error?.message || fallback, 500));

async function superAdmin(actorId) {
  if (!actorId) return { error: fail('Not signed in.', 401) };
  const { data: actor } = await supabaseAdmin
    .from('users').select('id, role, firstname, lastname').eq('id', String(actorId)).maybeSingle();
  if (!actor || actor.role !== 'Super Admin') {
    return { error: fail("Access denied. Only a Super Admin can manage Joy's knowledge.", 403) };
  }
  return { actor };
}

const titleFromFile = (name) => String(name || 'Document')
  .replace(/\.[^.]+$/, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120) || 'Document';

const cleanTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);

async function audit(actor, action, id, details) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      user_id: actor.id, action, resource: 'joy_knowledge', resource_id: id, details,
    });
  } catch { /* the change is made; the log is not worth failing over */ }
}

// One document and its sections. The sections go in batches; if any batch
// fails the document is removed again, so Joy never reads half a file.
async function saveDoc({ actor, title, fileName, type, size, text, url }) {
  const chunks = type === 'link' ? [text] : chunkText(text);
  if (chunks.length === 0) throw new Error('There is no text to add.');
  const row = {
    title,
    file_name: fileName || null,
    file_type: type,
    file_size: size ?? null,
    char_count: text.length,
    chunk_count: chunks.length,
    is_active: true,
    uploaded_by: actor.id,
    uploaded_by_name: [actor.firstname, actor.lastname].filter(Boolean).join(' ') || null,
    ...(url ? { url } : {}),
  };
  let { data: doc, error } = await supabaseAdmin.from(KNOWLEDGE_DOCS).insert(row).select(DOC_FIELDS).single();
  if (error && noUrlColumn(error)) {
    if (url) throw new Error(URL_COLUMN_NOTE);
    ({ data: doc, error } = await supabaseAdmin.from(KNOWLEDGE_DOCS).insert(row).select(OLD_DOC_FIELDS).single());
  }
  if (error) throw error;

  try {
    for (let i = 0; i < chunks.length; i += 500) {
      const rows = chunks.slice(i, i + 500).map((content, j) => ({ doc_id: doc.id, idx: i + j, content }));
      const { error: err } = await supabaseAdmin.from(KNOWLEDGE_CHUNKS).insert(rows);
      if (err) throw err;
    }
  } catch (err) {
    await supabaseAdmin.from(KNOWLEDGE_DOCS).delete().eq('id', doc.id);
    throw err;
  }

  // An older upload of the same file is replaced by this one.
  let replaced = 0;
  if (fileName) {
    const { data: older } = await supabaseAdmin
      .from(KNOWLEDGE_DOCS).select('id').eq('file_name', fileName).neq('id', doc.id);
    if (older?.length) {
      await supabaseAdmin.from(KNOWLEDGE_DOCS).delete().in('id', older.map((o) => o.id));
      replaced = older.length;
    }
  }
  forgetKnowledgeIndex();
  return { doc, replaced };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { error: denied } = await superAdmin(searchParams.get('actorId'));
    if (denied) return denied;

    const titleFor = searchParams.get('titleFor');
    if (titleFor) {
      try {
        return NextResponse.json({ success: true, data: { title: await fetchLinkTitle(titleFor) } });
      } catch (err) {
        return fail(err.message);
      }
    }

    const q = searchParams.get('q');
    if (q) {
      const sections = await searchKnowledge(q.slice(0, 500));
      return NextResponse.json({ success: true, data: sections });
    }

    const docId = searchParams.get('docId');
    if (docId) {
      const { data, error } = await supabaseAdmin
        .from(KNOWLEDGE_CHUNKS).select('idx, content').eq('doc_id', docId).order('idx').limit(12);
      if (error) throw error;
      const text = (data || []).map((c) => c.content).join('\n\n');
      return NextResponse.json({
        success: true,
        data: { text: text.slice(0, PREVIEW_CHARS), more: text.length > PREVIEW_CHARS || (data || []).length === 12 },
      });
    }

    const list = (fields) => supabaseAdmin
      .from(KNOWLEDGE_DOCS).select(fields).order('created_at', { ascending: false });
    let { data, error } = await list(DOC_FIELDS);
    if (error && noUrlColumn(error)) ({ data, error } = await list(OLD_DOC_FIELDS));
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return failFrom(error, "Could not load Joy's knowledge.");
  }
}

export async function POST(request) {
  try {
    const isForm = (request.headers.get('content-type') || '').includes('multipart/form-data');

    if (isForm) {
      const form = await request.formData();
      const { actor, error: denied } = await superAdmin(form.get('actorId'));
      if (denied) return denied;

      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return fail('Choose a file to upload.');
      if (file.size > MAX_FILE_BYTES) {
        return fail(`"${file.name}" is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB. Split it into smaller files, or save the PDF without pictures.`, 413);
      }

      let text;
      let type;
      try {
        ({ text, type } = await extractText(Buffer.from(await file.arrayBuffer()), file.name));
      } catch (err) {
        return fail(err.message);
      }
      const title = cleanTitle(form.get('title')) || titleFromFile(file.name);
      const { doc, replaced } = await saveDoc({ actor, title, fileName: file.name, type, size: file.size, text });
      await audit(actor, 'create', doc.id, `Joy's Knowledge: added "${title}" (${doc.chunk_count} sections)${replaced ? ', replacing the older copy' : ''}`);
      return NextResponse.json({ success: true, data: doc, replaced });
    }

    const body = (await request.json().catch(() => null)) || {};
    const { actor, error: denied } = await superAdmin(body.actorId);
    if (denied) return denied;

    // A link Joy may share: its address, a title (made from the address when
    // none is given) and, optionally, what it is for.
    if (body.kind === 'link') {
      const u = parseLink(body.url);
      if (!u || !/^https?:$/.test(u.protocol)) return fail('Paste a web address, starting with https://');
      const url = u.href;
      const title = cleanTitle(body.title) || await fetchLinkTitle(url);
      const about = normalizeText(body.about).replace(/\n+/g, ' ').slice(0, 300);
      // The same address added again replaces the old one.
      const { doc } = await saveDoc({ actor, title, fileName: null, type: 'link', size: null, text: linkContent({ url, title, about }), url });
      const { data: older } = await supabaseAdmin
        .from(KNOWLEDGE_DOCS).select('id').eq('url', url).neq('id', doc.id);
      if (older?.length) {
        await supabaseAdmin.from(KNOWLEDGE_DOCS).delete().in('id', older.map((o) => o.id));
        forgetKnowledgeIndex();
      }
      await audit(actor, 'create', doc.id, `Joy's Knowledge: added the link "${title}" (${url})`);
      return NextResponse.json({ success: true, data: doc, replaced: older?.length || 0 });
    }

    const title = cleanTitle(body.title);
    const text = normalizeText(body.text);
    if (!title) return fail('Give the note a title.');
    if (text.length < 20) return fail('Write a little more - at least a sentence or two.');
    if (text.length > 200000) return fail('That note is very long. Upload it as a file instead.');
    const { doc } = await saveDoc({ actor, title, fileName: null, type: 'note', size: null, text });
    await audit(actor, 'create', doc.id, `Joy's Knowledge: added the note "${title}"`);
    return NextResponse.json({ success: true, data: doc, replaced: 0 });
  } catch (error) {
    return failFrom(error, 'Could not add that to Joy.');
  }
}

export async function PATCH(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const { actor, error: denied } = await superAdmin(body.actorId);
    if (denied) return denied;
    if (!body.id) return fail('Which document?');

    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
    if (body.title !== undefined) {
      const title = cleanTitle(body.title);
      if (!title) return fail('The title cannot be empty.');
      patch.title = title;
    }
    const save = (fields) => supabaseAdmin
      .from(KNOWLEDGE_DOCS).update(patch).eq('id', body.id).select(fields).single();
    let { data, error } = await save(DOC_FIELDS);
    if (error && noUrlColumn(error)) ({ data, error } = await save(OLD_DOC_FIELDS));
    if (error) throw error;
    forgetKnowledgeIndex();
    await audit(actor, 'update', data.id, `Joy's Knowledge: "${data.title}" ${typeof body.is_active === 'boolean' ? (body.is_active ? 'turned on' : 'turned off') : 'renamed'}`);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return failFrom(error, 'Could not save that change.');
  }
}

export async function DELETE(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const { actor, error: denied } = await superAdmin(body.actorId);
    if (denied) return denied;
    if (!body.id) return fail('Which document?');
    const { data, error } = await supabaseAdmin
      .from(KNOWLEDGE_DOCS).delete().eq('id', body.id).select('id, title').maybeSingle();
    if (error) throw error;
    forgetKnowledgeIndex();
    if (data) await audit(actor, 'delete', data.id, `Joy's Knowledge: removed "${data.title}"`);
    return NextResponse.json({ success: true });
  } catch (error) {
    return failFrom(error, 'Could not remove that document.');
  }
}
