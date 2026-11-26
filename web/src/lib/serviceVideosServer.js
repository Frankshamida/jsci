// Service videos, server side. SERVER ONLY - it uses the service-role client
// (service_videos has RLS on and no policy, so nothing reaches it except
// through here).
//
//   loadPublishedVideos()  the list on /midweek: titles, dates, speakers, slugs,
//                       old slugs (to redirect old links) and thumbnail
//                       templates - never the video's link, which goes only to
//                       a signed-in account (watchableVideo, through
//                       /api/service-videos/watch)
//   publicVideo(row)    a video as the browser may see it (no old slugs)
//   resolveSlug(...)    the video a /midweek/<slug> address means, or the one
//                       it used to mean
//   allocateSlug(...)   a free slug for a title: "the-power-of-god", else with
//                       the date, "the-power-of-god-2026-12-02"
//   videoEditor(id)     the account behind a change, if it may make one
//   rowFrom(video)      what the dashboard sent, checked, as a row

import { supabaseAdmin } from '@/lib/supabase';
import { cached, cacheInvalidate } from '@/lib/serverCache';
import { getUserRoles } from '@/lib/permissions';
import {
  DEFAULT_CATEGORY, DEFAULT_TEMPLATE, categoryLabel, isCategory, isThumbnailTemplate, parseFacebookLink, slugify,
} from '@/lib/serviceVideos';

export const VIDEOS_TABLE = 'service_videos';
export const VIDEO_EDITOR_ROLES = ['Admin', 'Super Admin'];
export const VIDEOS_MIGRATION_NOTE = 'Service videos need their database table: run supabase/migrations/service_videos.sql in the Supabase SQL editor, then try again.';
export const MIDWEEK_MIGRATION_NOTE = 'Slugs and thumbnail templates need the updated table: run supabase/migrations/service_videos.sql again in the Supabase SQL editor (it is safe to run twice), then try again.';

export const videosTableMissing = (error) => {
  const msg = String(error?.message || error || '');
  return error?.code === '42P01' || error?.code === 'PGRST205' || (/service_videos/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg));
};

// The slug and template columns came after the table: a database without the
// update answers "column service_videos.slug does not exist".
const MIDWEEK_COLUMNS = ['slug', 'old_slugs', 'thumbnail_template'];
export const noMidweekColumns = (error) => {
  const msg = String(error?.message || '');
  return /(slug|old_slugs|thumbnail_template)/.test(msg) && /(column|schema cache)/i.test(msg);
};

// What is read for the list. Picked out again after the query, so the video's
// link cannot slip into the public list even if the select changes.
const LIST_COLUMNS = ['id', 'slug', 'old_slugs', 'title', 'speaker', 'description', 'category', 'service_date', 'thumbnail_template', 'created_at'];
const LIST_KEY = 'service-videos:published';
const LIST_TTL_MS = 20 * 1000;

// A free slug: the title's, else with the date, else with -2, -3 ... (A slug
// that is the date already - a Sunday Service's - goes straight to -2.)
export function freeSlug(base, date, taken) {
  if (!taken.has(base)) return base;
  const dated = date && !base.endsWith(date) ? `${base}-${date}` : base;
  if (!taken.has(dated)) return dated;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${dated}-${n}`)) return `${dated}-${n}`;
  return `${dated}-${Date.now().toString(36)}`;
}

// Straight from the database. The /midweek pages read it this way: they are
// cached themselves and rebuilt the moment a video changes (revalidatePath),
// and a copy kept here could be older than the change they are rebuilt for -
// each server instance keeps its own, and a change clears only one.
export async function loadPublishedVideos() {
  const query = (fields) => supabaseAdmin
    .from(VIDEOS_TABLE)
    .select(fields.join(', '))
    .eq('is_published', true)
    .order('service_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300);
  let { data, error } = await query(LIST_COLUMNS);
  if (error && noMidweekColumns(error)) ({ data, error } = await query(LIST_COLUMNS.filter((c) => !MIDWEEK_COLUMNS.includes(c))));
  if (error) throw error;

  const rows = (data || []).map((row) => Object.fromEntries(LIST_COLUMNS.map((k) => [k, row[k] ?? null])));
  // Before the update is run (or for a row it missed): slugs made here, by the
  // same rules, the oldest video getting the plain one.
  const taken = new Set(rows.flatMap((r) => [r.slug, ...(r.old_slugs || [])]).filter(Boolean));
  for (const r of [...rows].reverse()) {
    r.old_slugs = Array.isArray(r.old_slugs) ? r.old_slugs : [];
    if (!isThumbnailTemplate(r.thumbnail_template)) r.thumbnail_template = DEFAULT_TEMPLATE;
    if (!r.slug) {
      r.slug = freeSlug(slugify(r.title), r.service_date, taken);
      taken.add(r.slug);
    }
  }
  return rows;
}

// A video as the browser may see it.
export const publicVideo = ({ old_slugs: _old, ...rest }) => rest;

// Kept 20 s, for the public API that anyone may ask.
export const publishedVideos = () => cached(LIST_KEY, LIST_TTL_MS, loadPublishedVideos);
export const forgetPublishedVideos = () => cacheInvalidate(LIST_KEY);

// The list, or none when the table is not there yet (or the database is
// unreachable): /midweek then says there are no videos rather than failing.
export async function publishedVideosSafely() {
  try {
    return await loadPublishedVideos();
  } catch (error) {
    if (!videosTableMissing(error)) console.error('[service-videos]', error.message);
    return [];
  }
}

// { video } for a current slug, { moved } for one a video used to have
// (renamed since), or {} for none.
export function resolveSlug(list, slug) {
  const s = String(slug || '').toLowerCase();
  const video = list.find((v) => v.slug === s);
  if (video) return { video };
  const moved = list.find((v) => (v.old_slugs || []).includes(s));
  return moved ? { moved } : {};
}

// A free slug for a title, among every video's current and old slugs (an old
// slug stays reserved, so an old link never opens a different service).
export async function allocateSlug(title, date, exceptId = null) {
  const { data, error } = await supabaseAdmin.from(VIDEOS_TABLE).select('id, slug, old_slugs');
  if (error) throw error;
  const taken = new Set();
  for (const r of data || []) {
    if (r.id === exceptId) continue;
    if (r.slug) taken.add(r.slug);
    (r.old_slugs || []).forEach((s) => taken.add(s));
  }
  return freeSlug(slugify(title), date, taken);
}

// One published video, with its address.
export async function watchableVideo(id) {
  const { data, error } = await supabaseAdmin
    .from(VIDEOS_TABLE)
    .select('id, video_url')
    .eq('id', id)
    .eq('is_published', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// An Admin or a Super Admin, as the main role or an additional one.
export async function videoEditor(actorId) {
  if (!actorId) return { error: 'Not signed in.', status: 401 };
  const { data: user } = await supabaseAdmin
    .from('users').select('id, role, additional_roles, firstname, lastname, is_active')
    .eq('id', String(actorId)).maybeSingle();
  if (!user || user.is_active === false || !getUserRoles(user).some((r) => VIDEO_EDITOR_ROLES.includes(r))) {
    return { error: 'Access denied. Only an Admin or Super Admin can post the services.', status: 403 };
  }
  return { user, name: [user.firstname, user.lastname].filter(Boolean).join(' ') };
}

export const plain = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
// Line breaks kept, for a few lines about the message.
export const note = (v, max) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\r\n?/g, '\n')
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

export const realDate = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100;
};

// The dashboard's video, checked, as the columns to write (the slug is added
// by the route, which knows the other videos' slugs).
export function rowFrom(video) {
  const v = video || {};
  const parsed = parseFacebookLink(v.video_url);
  if (parsed.error) return { error: parsed.error };
  const category = isCategory(v.category) ? v.category : DEFAULT_CATEGORY;
  if (!realDate(v.service_date)) return { error: 'Pick the date of the service.' };
  const template = v.thumbnail_template ?? DEFAULT_TEMPLATE;
  if (!isThumbnailTemplate(template)) return { error: 'Pick one of the five thumbnail templates.' };
  return {
    row: {
      video_url: parsed.url,
      title: plain(v.title, 140) || categoryLabel(category),
      speaker: plain(v.speaker, 100) || null,
      description: note(v.description, 1500) || null,
      category,
      service_date: v.service_date,
      thumbnail_template: template,
      is_published: v.is_published !== false,
    },
    videoKey: parsed.key,
  };
}
