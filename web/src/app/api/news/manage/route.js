import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/cloudinary';
import {
  NEWS_CATEGORIES, blocksToText, hasContent, imagePublicIds, normalizeBlocks, normalizeTranslations, safeHref, slugify,
} from '@/lib/news';
import { NEWS_MIGRATION_NOTE, NEWS_TABLE, newsEditor, newsTableMissing } from '@/lib/newsServer';

export const dynamic = 'force-dynamic';

// Dashboard > News and the editor at /news-studio. Admin and Super Admin only.
//
//   GET    ?actorId=              every article, drafts too (no bodies)
//   GET    ?actorId=&id=          one article, whole
//   POST   { actorId, article }   a new one
//   PUT    { actorId, id, article, action? }  save it; action 'publish' |
//                                 'unpublish' | 'feature' | 'unfeature' changes
//                                 only that
//   DELETE { actorId, id }
//
// Saving as a draft asks for nothing but a title. Publishing asks for a
// title, a summary and something in the body.

const ADMIN_LIST_FIELDS = 'id, title, slug, summary, category, featured_image_url, author_name, status, is_featured, views, published_at, created_at, updated_at';

const TRANSLATIONS_NOTE = 'Saved, but without the translations: run supabase/migrations/news_articles.sql again in the Supabase SQL editor (it is safe to run twice), then save again.';
const noTranslationsColumn = (error) => /translations/.test(error?.message || '') && /(column|schema cache)/i.test(error?.message || '');

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const failFrom = (error, fallback) => (newsTableMissing(error)
  ? fail(NEWS_MIGRATION_NOTE, 503)
  : fail(error?.message || fallback, 500));

const plain = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

async function audit(user, action, id, details) {
  try {
    await supabaseAdmin.from('audit_logs').insert({ user_id: user.id, action, resource: 'news_article', resource_id: id, details });
  } catch { /* the article is saved; the log is not worth failing over */ }
}

// The public pages are cached for a minute; a change should show at once.
const refreshPages = (slugs = []) => {
  try {
    revalidatePath('/news');
    slugs.filter(Boolean).forEach((s) => revalidatePath(`/news/${s}`));
  } catch { /* the cache catches up by itself */ }
};

// Pictures that were in the old version and are not in the new one.
async function dropImages(ids) {
  await Promise.allSettled(ids.map((id) => deleteFromCloudinary(id, 'image')));
}

// A free address: the slug asked for, or with -2, -3 ... after it.
async function freeSlug(wanted, exceptId) {
  const base = slugify(wanted) || 'article';
  const { data } = await supabaseAdmin.from(NEWS_TABLE).select('id, slug').like('slug', `${base}%`);
  const taken = new Set((data || []).filter((r) => r.id !== exceptId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36)}`;
}

// The browser's article, made into a row.
function rowFrom(article, { publishing }) {
  const a = article || {};
  const title = plain(a.title, 200);
  const blocks = normalizeBlocks(a.content);
  const summary = String(a.summary ?? '').replace(/[<>]/g, '').trim().slice(0, 500);
  const source = String(a.source_url || '').trim();
  const featured = a.featured_image && /^https:\/\//i.test(String(a.featured_image.url || ''))
    ? { url: String(a.featured_image.url).trim(), publicId: a.featured_image.publicId ? plain(a.featured_image.publicId, 300) : null }
    : null;

  if (!title) return { error: 'Give the article a title.' };
  if (source && !(safeHref(source) && /^https?:\/\//i.test(source))) return { error: 'The original source must be a web address starting with https://' };
  if (publishing) {
    if (!summary) return { error: 'Write a short summary before publishing. It shows under the title and when the article is shared.' };
    if (!hasContent(blocks)) return { error: 'The article has no text or pictures yet.' };
  }

  return {
    row: {
      title,
      summary: summary || null,
      category: NEWS_CATEGORIES.includes(a.category) ? a.category : 'Church News',
      tags: [...new Set((Array.isArray(a.tags) ? a.tags : []).map((t) => plain(t, 30)).filter(Boolean))].slice(0, 8),
      content: blocks,
      content_text: blocksToText(blocks).slice(0, 100000),
      featured_image_url: featured?.url || null,
      featured_image_public_id: featured?.publicId || null,
      image_public_ids: imagePublicIds(blocks),
      source_url: source || null,
      author_name: plain(a.author_name, 80) || null,
      is_featured: a.is_featured === true,
      ...(a.translations !== undefined ? { translations: normalizeTranslations(a.translations) } : {}),
    },
    wantedSlug: a.slug,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const who = await newsEditor(searchParams.get('actorId'));
    if (who.error) return fail(who.error, who.status);

    const id = searchParams.get('id');
    if (id) {
      const { data, error } = await supabaseAdmin.from(NEWS_TABLE).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return fail('That article is not there any more.', 404);
      return NextResponse.json({ success: true, data });
    }

    const { data, error } = await supabaseAdmin
      .from(NEWS_TABLE).select(ADMIN_LIST_FIELDS).order('updated_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return failFrom(error, 'Could not load the articles.');
  }
}

export async function POST(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);

    const publishing = body.article?.status === 'published';
    const { row, wantedSlug, error: invalid } = rowFrom(body.article, { publishing });
    if (invalid) return fail(invalid);

    const now = new Date().toISOString();
    const insert = {
      ...row,
      slug: await freeSlug(wantedSlug || row.title),
      author_name: row.author_name || who.name || 'Church News Desk',
      author_id: who.user.id,
      status: publishing ? 'published' : 'draft',
      published_at: publishing ? now : null,
      created_by: who.user.id,
      updated_by: who.user.id,
      updated_at: now,
    };
    if (insert.is_featured) await supabaseAdmin.from(NEWS_TABLE).update({ is_featured: false }).eq('is_featured', true);

    let warning = null;
    let { data, error } = await supabaseAdmin.from(NEWS_TABLE).insert(insert).select('*').single();
    if (error && noTranslationsColumn(error)) {
      delete insert.translations;
      ({ data, error } = await supabaseAdmin.from(NEWS_TABLE).insert(insert).select('*').single());
      warning = TRANSLATIONS_NOTE;
    }
    if (error) throw error;
    await audit(who.user, 'create', data.id, `News: ${publishing ? 'published' : 'drafted'} "${data.title}"`);
    if (publishing) refreshPages([data.slug]);
    return NextResponse.json({ success: true, data, warning });
  } catch (error) {
    return failFrom(error, 'Could not save the article.');
  }
}

export async function PUT(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);
    if (!body.id) return fail('Which article?');

    const { data: old, error: readErr } = await supabaseAdmin.from(NEWS_TABLE).select('*').eq('id', body.id).maybeSingle();
    if (readErr) throw readErr;
    if (!old) return fail('That article is not there any more.', 404);
    const now = new Date().toISOString();

    // One switch from the list: publish, unpublish, feature, unfeature.
    if (body.action) {
      const patch = { updated_by: who.user.id, updated_at: now };
      if (body.action === 'publish') {
        if (!old.summary || !hasContent(old.content)) return fail('Open the article and add a summary and some content before publishing.');
        patch.status = 'published';
        patch.published_at = old.published_at || now;
      } else if (body.action === 'unpublish') {
        patch.status = 'draft';
        patch.is_featured = false;
      } else if (body.action === 'feature') {
        if (old.status !== 'published') return fail('Publish the article first, then feature it.');
        await supabaseAdmin.from(NEWS_TABLE).update({ is_featured: false }).eq('is_featured', true);
        patch.is_featured = true;
      } else if (body.action === 'unfeature') {
        patch.is_featured = false;
      } else {
        return fail('Unknown action.');
      }
      const { data, error } = await supabaseAdmin.from(NEWS_TABLE).update(patch).eq('id', old.id).select('*').single();
      if (error) throw error;
      await audit(who.user, 'update', old.id, `News: ${body.action} "${old.title}"`);
      refreshPages([old.slug]);
      return NextResponse.json({ success: true, data });
    }

    const publishing = body.article?.status === 'published';
    const { row, wantedSlug, error: invalid } = rowFrom(body.article, { publishing });
    if (invalid) return fail(invalid);

    const slug = wantedSlug && slugify(wantedSlug) !== old.slug ? await freeSlug(wantedSlug, old.id) : old.slug;
    const update = {
      ...row,
      slug,
      author_name: row.author_name || old.author_name,
      status: publishing ? 'published' : 'draft',
      published_at: publishing ? (old.published_at || now) : old.published_at,
      is_featured: publishing ? row.is_featured : false,
      updated_by: who.user.id,
      updated_at: now,
    };
    if (update.is_featured && !old.is_featured) {
      await supabaseAdmin.from(NEWS_TABLE).update({ is_featured: false }).eq('is_featured', true);
    }
    let warning = null;
    let { data, error } = await supabaseAdmin.from(NEWS_TABLE).update(update).eq('id', old.id).select('*').single();
    if (error && noTranslationsColumn(error)) {
      delete update.translations;
      ({ data, error } = await supabaseAdmin.from(NEWS_TABLE).update(update).eq('id', old.id).select('*').single());
      warning = TRANSLATIONS_NOTE;
    }
    if (error) throw error;

    const before = [old.featured_image_public_id, ...(old.image_public_ids || [])].filter(Boolean);
    const after = new Set([data.featured_image_public_id, ...(data.image_public_ids || [])].filter(Boolean));
    await dropImages(before.filter((p) => !after.has(p)));

    await audit(who.user, 'update', old.id, `News: ${publishing ? (old.status === 'published' ? 'updated' : 'published') : 'saved a draft of'} "${data.title}"`);
    refreshPages([old.slug, data.slug]);
    return NextResponse.json({ success: true, data, warning });
  } catch (error) {
    return failFrom(error, 'Could not save the article.');
  }
}

export async function DELETE(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);
    if (!body.id) return fail('Which article?');
    const { data, error } = await supabaseAdmin
      .from(NEWS_TABLE).delete().eq('id', body.id)
      .select('id, title, slug, featured_image_public_id, image_public_ids').maybeSingle();
    if (error) throw error;
    if (data) {
      await dropImages([data.featured_image_public_id, ...(data.image_public_ids || [])].filter(Boolean));
      await audit(who.user, 'delete', data.id, `News: deleted "${data.title}"`);
      refreshPages([data.slug]);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return failFrom(error, 'Could not delete the article.');
  }
}
