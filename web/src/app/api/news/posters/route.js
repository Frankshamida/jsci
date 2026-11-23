import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { blockImages } from '@/lib/news';
import {
  NEWS_MIGRATION_NOTE, NEWS_TABLE, POSTERS_MIGRATION_NOTE, POSTERS_TABLE, dropUnusedNewsImages, newsEditor,
  newsTableMissing, postersTableMissing,
} from '@/lib/newsServer';
import {
  POSTER_SETTINGS_KEY, TEMPLATE_KEYS, normalizePosterData, normalizePosterDefaults,
} from '@/lib/posterTemplates';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// The poster editor (/news-management/poster/<article>). Admin and Super
// Admin only, like the rest of News.
//
//   GET    ?actorId=&articleId=          the article (what a poster is made
//                                        from), its pictures, its saved
//                                        posters and the footer defaults
//   POST   { actorId, articleId, poster: { name, template_key, data, preview_url } }
//   PUT    { actorId, id, poster: { ...any of those } }      save or rename
//   PUT    { actorId, defaults: { website, facebook } }      church defaults
//   DELETE { actorId, id }
//
// A poster's own uploaded photo is removed from Cloudinary when nothing
// shows it any more (the poster is deleted or given another photo).

const POSTER_FIELDS = 'id, article_id, name, template_key, data, preview_url, created_at, updated_at';

const fail = (message, status = 400) => NextResponse.json({ success: false, message }, { status });
const failFrom = (error, fallback) => {
  if (postersTableMissing(error)) return fail(POSTERS_MIGRATION_NOTE, 503);
  if (newsTableMissing(error)) return fail(NEWS_MIGRATION_NOTE, 503);
  return fail(error?.message || fallback, 500);
};

const plain = (v, max) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// A small JPEG made by the editor, for the list of versions.
const cleanPreview = (v) => {
  const s = String(v || '');
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= 120000 ? s : null;
};

// The fields of a poster the browser sent, checked. `partial`: only those given.
function posterRow(p, { partial = false } = {}) {
  const src = p && typeof p === 'object' ? p : {};
  const row = {};
  if (!partial || src.name !== undefined) row.name = plain(src.name, 60) || 'Poster';
  if (!partial || src.template_key !== undefined) row.template_key = TEMPLATE_KEYS.includes(src.template_key) ? src.template_key : TEMPLATE_KEYS[0];
  if (!partial || src.data !== undefined) row.data = normalizePosterData(src.data);
  if (!partial || src.preview_url !== undefined) row.preview_url = cleanPreview(src.preview_url);
  return row;
}

async function readDefaults() {
  const { data } = await supabaseAdmin.from('system_settings').select('value').eq('key', POSTER_SETTINGS_KEY).maybeSingle();
  return normalizePosterDefaults(data?.value);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const who = await newsEditor(searchParams.get('actorId'));
    if (who.error) return fail(who.error, who.status);
    const articleId = searchParams.get('articleId');
    if (!articleId) return fail('Which article?');

    const { data: article, error } = await supabaseAdmin
      .from(NEWS_TABLE)
      .select('id, title, slug, summary, category, tags, content, status, published_at, author_name, featured_image_url, featured_image_public_id')
      .eq('id', articleId).maybeSingle();
    if (error) throw error;
    if (!article) return fail('That article is not there any more.', 404);

    // Every picture in the body, once, to choose the poster photo from.
    const seen = new Set([article.featured_image_url].filter(Boolean));
    const images = [];
    (Array.isArray(article.content) ? article.content : []).flatMap(blockImages).forEach((img) => {
      if (!img?.url || seen.has(img.url)) return;
      seen.add(img.url);
      images.push({ url: img.url, publicId: img.publicId || null, caption: img.caption || '' });
    });
    const { content, ...meta } = article;

    let posters = [];
    let setupNote = null;
    const list = await supabaseAdmin
      .from(POSTERS_TABLE).select(POSTER_FIELDS)
      .eq('article_id', article.id).order('updated_at', { ascending: false });
    if (list.error) {
      if (!postersTableMissing(list.error)) throw list.error;
      setupNote = POSTERS_MIGRATION_NOTE;
    } else {
      posters = list.data || [];
    }

    return NextResponse.json({
      success: true,
      data: { article: meta, images, posters, defaults: await readDefaults(), setupNote },
    });
  } catch (error) {
    return failFrom(error, 'Could not open the poster editor.');
  }
}

export async function POST(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);

    const { data: article, error: articleError } = await supabaseAdmin
      .from(NEWS_TABLE).select('id').eq('id', String(body.articleId || '')).maybeSingle();
    if (articleError) throw articleError;
    if (!article) return fail('That article is not there any more.', 404);

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from(POSTERS_TABLE).insert({
      ...posterRow(body.poster),
      article_id: article.id,
      created_by: who.user.id,
      updated_by: who.user.id,
      created_at: now,
      updated_at: now,
    }).select(POSTER_FIELDS).single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return failFrom(error, 'Could not save the poster.');
  }
}

export async function PUT(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);

    // The church's website and Facebook page, for every new poster.
    if (body.defaults) {
      const value = normalizePosterDefaults(body.defaults);
      const { error } = await supabaseAdmin.from('system_settings').upsert({
        key: POSTER_SETTINGS_KEY,
        value,
        description: 'News posters: the website and Facebook page shown in the footer of a new poster.',
        updated_by: who.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
      if (error) throw error;
      return NextResponse.json({ success: true, data: value });
    }

    if (!body.id) return fail('Which poster?');
    const { data: old, error: oldError } = await supabaseAdmin
      .from(POSTERS_TABLE).select('id, data').eq('id', String(body.id)).maybeSingle();
    if (oldError) throw oldError;
    if (!old) return fail('That poster is not there any more.', 404);

    const row = posterRow(body.poster, { partial: true });
    if (!Object.keys(row).length) return fail('Nothing to save.');
    const { data, error } = await supabaseAdmin
      .from(POSTERS_TABLE)
      .update({ ...row, updated_by: who.user.id, updated_at: new Date().toISOString() })
      .eq('id', old.id).select(POSTER_FIELDS).single();
    if (error) throw error;

    const before = old.data?.imagePublicId;
    if (before && row.data && row.data.imagePublicId !== before) await dropUnusedNewsImages([before]);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return failFrom(error, 'Could not save the poster.');
  }
}

export async function DELETE(request) {
  try {
    const body = (await request.json().catch(() => null)) || {};
    const who = await newsEditor(body.actorId);
    if (who.error) return fail(who.error, who.status);
    if (!body.id) return fail('Which poster?');
    const { data, error } = await supabaseAdmin
      .from(POSTERS_TABLE).delete().eq('id', String(body.id)).select('id, data').maybeSingle();
    if (error) throw error;
    if (data?.data?.imagePublicId) await dropUnusedNewsImages([data.data.imagePublicId]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return failFrom(error, 'Could not delete the poster.');
  }
}
