import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { NO_STORE } from '@/lib/watchAccess';
import { parseAmount } from '@/lib/giving';
import {
  CAMPAIGNS, GIVING_MIGRATION_NOTE, IMAGES_MIGRATION_NOTE, MAX_IMAGES, allocateCampaignSlug, campaignImages, campaignTotals,
  forgetGiving, givingAdmin, givingTablesMissing, logGiving, noImagesColumn, note, plain, realDate,
} from '@/lib/givingServer';

export const dynamic = 'force-dynamic';

// Dashboard > Giving > Donation drives (Admin and Super Admin): what the
// church is asked to donate to. Published ones have their own page
// (/donation/<slug>) with their photos and their jar; featured ones are also
// shown beside the News, in the Community Hub and on the home page, until the
// day they end.

const reply = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const denied = (who) => reply({ success: false, message: who.error }, who.status);
const trouble = (error) => {
  if (givingTablesMissing(error)) return reply({ success: false, message: GIVING_MIGRATION_NOTE }, 503);
  if (noImagesColumn(error)) return reply({ success: false, message: IMAGES_MIGRATION_NOTE }, 503);
  console.error('[giving campaigns]', error.message);
  return reply({ success: false, message: error.message || 'Something went wrong.' }, 500);
};

// The dashboard's campaign, checked, as the columns to write.
function rowFrom(c) {
  const title = plain(c?.title, 120);
  if (title.length < 3) return { error: 'Give the campaign a title.' };
  // The photos, in order (the first is the cover). Older forms send one image_url.
  const raw = Array.isArray(c?.images) ? c.images : c?.image_url ? [c.image_url] : [];
  const images = [...new Set(raw.map((u) => String(u || '').trim()).filter(Boolean))];
  if (images.length > MAX_IMAGES) return { error: `A drive can have up to ${MAX_IMAGES} photos.` };
  if (images.some((u) => !/^https:\/\/[^\s"'<>]+$/.test(u))) return { error: 'Every photo must be an https:// link. Upload them here instead.' };
  let goal = null;
  if (c?.goal_amount !== '' && c?.goal_amount != null) {
    goal = parseAmount(c.goal_amount);
    if (!goal) return { error: 'The goal must be an amount, like 50000 - or leave it empty.' };
  }
  const ends = c?.ends_on ? String(c.ends_on) : null;
  if (ends && !realDate(ends)) return { error: 'Pick the day the campaign ends, or leave it empty.' };
  return {
    row: {
      title,
      summary: plain(c?.summary, 200) || null,
      story: note(c?.story, 5000) || null,
      images,
      image_url: images[0] || null,
      goal_amount: goal,
      ends_on: ends,
      is_published: c?.is_published !== false,
      is_featured: c?.is_featured !== false,
    },
  };
}

const withTotals = async (rows) => {
  const totals = await campaignTotals((rows || []).map((r) => r.id));
  return (rows || []).map((r) => ({
    ...r,
    images: campaignImages(r),
    goal_amount: r.goal_amount != null ? Number(r.goal_amount) : null,
    raised: Math.round((totals[r.id]?.raised || 0) * 100) / 100,
    gifts: totals[r.id]?.gifts || 0,
  }));
};

export async function GET(request) {
  const who = await givingAdmin(new URL(request.url).searchParams.get('actorId'));
  if (who.error) return denied(who);
  try {
    const { data, error } = await supabaseAdmin.from(CAMPAIGNS).select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return reply({ success: true, data: await withTotals(data) });
  } catch (error) { return trouble(error); }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const who = await givingAdmin(body.actorId);
  if (who.error) return denied(who);
  const checked = rowFrom(body.campaign);
  if (checked.error) return reply({ success: false, message: checked.error }, 400);
  try {
    const slug = await allocateCampaignSlug(checked.row.title);
    const { data, error } = await supabaseAdmin.from(CAMPAIGNS).insert({
      ...checked.row, slug, created_by: who.user.id, created_by_name: who.name,
    }).select('*').single();
    if (error) throw error;
    await logGiving(who, 'giving_campaign_create', data.id, `Created the giving campaign "${data.title}"`);
    forgetGiving({ news: true });
    return reply({ success: true, data: (await withTotals([data]))[0] });
  } catch (error) { return trouble(error); }
}

const ACTIONS = {
  publish: { is_published: true },
  hide: { is_published: false },
  feature: { is_featured: true, is_published: true },
  unfeature: { is_featured: false },
};

export async function PUT(request) {
  const body = await request.json().catch(() => ({}));
  const who = await givingAdmin(body.actorId);
  if (who.error) return denied(who);
  if (!body.id) return reply({ success: false, message: 'Which campaign?' }, 400);
  try {
    let patch;
    if (body.action) {
      patch = ACTIONS[body.action];
      if (!patch) return reply({ success: false, message: 'Unknown action.' }, 400);
    } else {
      const checked = rowFrom(body.campaign);
      if (checked.error) return reply({ success: false, message: checked.error }, 400);
      patch = checked.row;
      const { data: before } = await supabaseAdmin.from(CAMPAIGNS).select('title, slug').eq('id', body.id).maybeSingle();
      if (!before) return reply({ success: false, message: 'That campaign is gone.' }, 404);
      // A new title, a new address. (Links to the old one would 404 - a
      // campaign is rarely renamed once shared, so it is said in the form.)
      if (before.title !== patch.title) patch.slug = await allocateCampaignSlug(patch.title, body.id);
    }
    const { data, error } = await supabaseAdmin.from(CAMPAIGNS)
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', body.id).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return reply({ success: false, message: 'That campaign is gone.' }, 404);
    await logGiving(who, `giving_campaign_${body.action || 'update'}`, data.id, `${body.action || 'Edited'} the giving campaign "${data.title}"`);
    forgetGiving({ news: true });
    return reply({ success: true, data: (await withTotals([data]))[0] });
  } catch (error) { return trouble(error); }
}

export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  const who = await givingAdmin(body.actorId);
  if (who.error) return denied(who);
  try {
    const { data, error } = await supabaseAdmin.from(CAMPAIGNS).delete().eq('id', body.id).select('id, title').maybeSingle();
    if (error) throw error;
    if (!data) return reply({ success: false, message: 'That campaign is gone.' }, 404);
    // Its gifts stay, with its title on them (campaign_title).
    await logGiving(who, 'giving_campaign_delete', data.id, `Deleted the giving campaign "${data.title}"`);
    forgetGiving({ news: true });
    return reply({ success: true });
  } catch (error) { return trouble(error); }
}
