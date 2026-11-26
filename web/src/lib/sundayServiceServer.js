// The Sunday Service (live_streams), server side. SERVER ONLY - it uses the
// service-role client.
//
//   loadPublishedStreams()  the list on /sunday-service: titles, dates,
//                        speakers, slugs, templates and which one is live -
//                        never the player's address, which goes only to a
//                        signed-in account (watchableStream, through
//                        /api/live-streams/watch)
//   publicStream(row)    a stream as the browser may see it
//   allocateStreamSlug() a free slug: the date for a plain "Sunday Service"
//                        (2026-11-29), the title for one with its own
//   streamRowFrom(...)   what the dashboard sent, checked, as a row

import { supabaseAdmin } from '@/lib/supabase';
import { DEFAULT_TEMPLATE, isThumbnailTemplate } from '@/lib/serviceVideos';
import { freeSlug, note, plain, realDate } from '@/lib/serviceVideosServer';
import { SUNDAY_LABEL, parseLiveEmbed, streamDate, streamTitle, sundaySlugBase } from '@/lib/sundayService';

export const STREAMS_TABLE = 'live_streams';
export const SUNDAY_MIGRATION_NOTE = 'The Sunday Service needs its updated table: run supabase/migrations/sunday_service.sql in the Supabase SQL editor (it is safe to run twice), then try again.';

// The columns the Sunday Service added to live_streams. A database without
// them answers "column live_streams.slug does not exist".
const SUNDAY_COLUMNS = ['slug', 'old_slugs', 'thumbnail_template', 'service_date', 'speaker', 'description'];
export const noSundayColumns = (error) => {
  const msg = String(error?.message || '');
  return SUNDAY_COLUMNS.some((c) => msg.includes(c)) && /(column|schema cache)/i.test(msg);
};

// Is the table updated? Asked once per list in the dashboard.
export async function sundayColumnsReady() {
  const { error } = await supabaseAdmin.from(STREAMS_TABLE).select('slug, thumbnail_template, service_date').limit(1);
  if (error && noSundayColumns(error)) return false;
  if (error) throw error;
  return true;
}

const LIST_COLUMNS = ['id', 'slug', 'old_slugs', 'title', 'caption', 'speaker', 'description', 'service_date', 'thumbnail_template', 'is_live', 'created_at'];

// Newest service first; on the same day, the latest posted.
const newestFirst = (a, b) => String(b.service_date).localeCompare(String(a.service_date))
  || String(b.created_at).localeCompare(String(a.created_at));

// Straight from the database (the /sunday-service pages are cached
// themselves, and rebuilt the moment a stream changes).
export async function loadPublishedStreams() {
  const query = (fields) => supabaseAdmin
    .from(STREAMS_TABLE)
    .select(fields.join(', '))
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(300);
  let { data, error } = await query(LIST_COLUMNS);
  if (error && noSundayColumns(error)) ({ data, error } = await query(LIST_COLUMNS.filter((c) => !SUNDAY_COLUMNS.includes(c))));
  if (error) throw error;

  const rows = (data || []).map((r) => ({
    id: r.id,
    slug: r.slug || null,
    old_slugs: Array.isArray(r.old_slugs) ? r.old_slugs : [],
    title: streamTitle(r),
    speaker: r.speaker || null,
    description: r.description || null,
    service_date: streamDate(r),
    thumbnail_template: isThumbnailTemplate(r.thumbnail_template) ? r.thumbnail_template : DEFAULT_TEMPLATE,
    is_live: !!r.is_live,
    created_at: r.created_at,
  })).sort(newestFirst);

  // Before the update is run (or for a row it missed): slugs made here, by the
  // same rules, the oldest stream getting the plain one.
  const taken = new Set(rows.flatMap((r) => [r.slug, ...r.old_slugs]).filter(Boolean));
  for (const r of [...rows].reverse()) {
    if (!r.slug) {
      r.slug = freeSlug(sundaySlugBase(r.title, r.service_date), r.service_date, taken);
      taken.add(r.slug);
    }
  }
  return rows;
}

// A stream as the browser may see it.
export const publicStream = ({ old_slugs: _old, ...rest }) => rest;

// The list, or none when the database cannot be reached: the page then says
// there is no service yet rather than failing.
export async function publishedStreamsSafely() {
  try {
    return await loadPublishedStreams();
  } catch (error) {
    console.error('[sunday-service]', error.message);
    return [];
  }
}

// A free slug among every stream's current and old slugs.
export async function allocateStreamSlug(title, date, exceptId = null) {
  const { data, error } = await supabaseAdmin.from(STREAMS_TABLE).select('id, slug, old_slugs');
  if (error) throw error;
  const taken = new Set();
  for (const r of data || []) {
    if (r.id === exceptId) continue;
    if (r.slug) taken.add(r.slug);
    (r.old_slugs || []).forEach((s) => taken.add(s));
  }
  return freeSlug(sundaySlugBase(title, date), date, taken);
}

// One stream on the website, with its player.
export async function watchableStream(id) {
  const { data, error } = await supabaseAdmin
    .from(STREAMS_TABLE)
    .select('id, iframe_url')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const parsed = parseLiveEmbed(data.iframe_url);
  return { id: data.id, src: parsed.src || null, link: parsed.link || null };
}

// The dashboard's stream, checked, as the columns to write (the slug is added
// by the route, which knows the other streams' slugs).
export function streamRowFrom(stream) {
  const s = stream || {};
  const parsed = parseLiveEmbed(s.embed);
  if (parsed.error) return { error: parsed.error };
  if (!realDate(s.service_date)) return { error: 'Pick the date of the service.' };
  const template = s.thumbnail_template ?? DEFAULT_TEMPLATE;
  if (!isThumbnailTemplate(template)) return { error: 'Pick one of the five thumbnail templates.' };
  const title = plain(s.title, 140) || SUNDAY_LABEL;
  return {
    row: {
      iframe_url: parsed.src,
      title,
      caption: title, // the Community Hub shows the caption
      speaker: plain(s.speaker, 100) || null,
      description: note(s.description, 1500) || null,
      service_date: s.service_date,
      thumbnail_template: template,
      is_live: s.is_live === true,
      is_active: s.is_active !== false,
    },
    videoKey: parsed.key,
  };
}
