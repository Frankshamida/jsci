// News, server side: who may write it, and reading it out of the database.
// SERVER ONLY - it uses the service-role client (news_articles has RLS on and
// no policy, so nothing reaches it except through these functions).

import { supabaseAdmin } from '@/lib/supabase';
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
