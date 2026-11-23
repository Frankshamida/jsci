// News, server side: who may write it, and reading it out of the database.
// SERVER ONLY - it uses the service-role client (news_articles has RLS on and
// no policy, so nothing reaches it except through these functions).

import { supabaseAdmin } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/cloudinary';
import { getUserRoles } from '@/lib/permissions';
import { LIST_FIELDS } from '@/lib/news';

export const NEWS_TABLE = 'news_articles';
export const NEWS_EDITOR_ROLES = ['Admin', 'Super Admin'];
export const NEWS_MIGRATION_NOTE = 'News needs its database table: run supabase/migrations/news_articles.sql in the Supabase SQL editor, then try again.';

export const newsTableMissing = (error) => {
  const msg = String(error?.message || error || '');
  return error?.code === '42P01' || error?.code === 'PGRST205' || (/news_articles/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg));
};

// The account behind a request, if it may write news: an Admin or a Super
// Admin, as its main role or an additional one.
export async function newsEditor(actorId) {
  if (!actorId) return { error: 'Not signed in.', status: 401 };
  const { data: user } = await supabaseAdmin
    .from('users').select('id, role, additional_roles, firstname, lastname, is_active')
    .eq('id', String(actorId)).maybeSingle();
  if (!user || user.is_active === false || !getUserRoles(user).some((r) => NEWS_EDITOR_ROLES.includes(r))) {
    return { error: 'Access denied. Only an Admin or Super Admin can manage news.', status: 403 };
  }
  return { user, name: [user.firstname, user.lastname].filter(Boolean).join(' ') };
}

// ---- Posters (news_posters: saved poster versions of an article) ----

export const POSTERS_TABLE = 'news_posters';
export const POSTERS_MIGRATION_NOTE = 'To save poster versions, run supabase/migrations/news_posters.sql in the Supabase SQL editor. You can still make and download posters.';

export const postersTableMissing = (error) => {
  const msg = String(error?.message || error || '');
  return error?.code === '42P01' || error?.code === 'PGRST205' || (/news_posters/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg));
};

// Of these Cloudinary pictures, the ones a saved poster still shows. An
// article's tidy-up must leave those alone. (No posters table yet: none.)
export async function imagesInPosters(publicIds) {
  const ids = [...new Set((publicIds || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const { data, error } = await supabaseAdmin
    .from(POSTERS_TABLE).select('data->>imagePublicId')
    .in('data->>imagePublicId', ids);
  if (error) return new Set();
  return new Set((data || []).map((r) => r.imagePublicId).filter(Boolean));
}

// Is a news picture still shown anywhere - in any article, or any poster?
async function imageInUse(publicId) {
  const [featured, body, posters] = await Promise.all([
    supabaseAdmin.from(NEWS_TABLE).select('id').eq('featured_image_public_id', publicId).limit(1),
    supabaseAdmin.from(NEWS_TABLE).select('id').contains('image_public_ids', [publicId]).limit(1),
    supabaseAdmin.from(POSTERS_TABLE).select('id').eq('data->>imagePublicId', publicId).limit(1),
  ]);
  // When unsure, keep it: a stray picture costs little, a missing one breaks a page.
  if (featured.error || body.error) return true;
  return Boolean(featured.data?.length || body.data?.length || posters.data?.length);
}

// Delete pictures from Cloudinary that nothing shows any more. Only news
// pictures (uploaded through /api/news/upload) are ever considered.
export async function dropUnusedNewsImages(publicIds) {
  const ids = [...new Set((publicIds || []).filter((id) => typeof id === 'string' && id.startsWith('JSCI-System/news/')))];
  await Promise.allSettled(ids.map(async (id) => {
    if (!(await imageInUse(id))) await deleteFromCloudinary(id, 'image');
  }));
}

// ---- Published articles, for the public pages ----

export async function publishedList({ limit = 24, offset = 0, category = null } = {}) {
  let q = supabaseAdmin
    .from(NEWS_TABLE).select(LIST_FIELDS, { count: 'exact' })
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (category) q = q.eq('category', category);
  const { data, error, count } = await q;
  if (error) throw error;
  return { articles: data || [], total: count || 0 };
}

// How many published stories each topic has: { 'Church News': 4, ... }.
export async function categoryCounts() {
  const { data, error } = await supabaseAdmin
    .from(NEWS_TABLE).select('category')
    .eq('status', 'published');
  if (error) throw error;
  const counts = {};
  (data || []).forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  return counts;
}

export async function publishedArticle(slug) {
  const { data, error } = await supabaseAdmin
    .from(NEWS_TABLE).select('*')
    .eq('slug', String(slug || '').toLowerCase())
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Most read in the last two months; if nothing has been read yet, newest.
export async function trendingList({ limit = 5, exclude = null } = {}) {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  let q = supabaseAdmin
    .from(NEWS_TABLE).select(LIST_FIELDS)
    .eq('status', 'published').gte('published_at', since)
    .order('views', { ascending: false }).order('published_at', { ascending: false })
    .limit(limit + 1);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).filter((a) => a.id !== exclude).slice(0, limit);
}

// The public pages ask through these, and show an empty page - not an error -
// when the table is not there yet.
export async function safely(fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    if (!newsTableMissing(error)) console.error('[news]', error.message);
    return fallback;
  }
}
