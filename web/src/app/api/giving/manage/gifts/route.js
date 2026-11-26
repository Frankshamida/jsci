import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { NO_STORE } from '@/lib/watchAccess';
import { formatPersonName } from '@/lib/eventFormat';
import { emailReady } from '@/lib/mailer';
import { EMAIL_RE, MAX_AMOUNT, isFund, parseAmount, peso } from '@/lib/giving';
import {
  CAMPAIGNS, GIFTS, GIVING_MIGRATION_NOTE, cleanEmail, forgetGiving, givingAdmin, givingTablesMissing, logGiving,
  newReceiptNo, newToken, note, plain, sendConfirmedEmail,
} from '@/lib/givingServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Dashboard > Giving > Gifts (Admin and Super Admin): every gift sent, to
// match against the church's GCash, Maya and bank history. Confirm one and its
// giver is emailed a thank-you with the jar; mark it failed when the money
// never came, or refunded when it was given back. Gifts handed over in person
// (cash, a card at the church) are recorded here too.

const reply = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const denied = (who) => reply({ success: false, message: who.error }, who.status);
const trouble = (error) => {
  if (givingTablesMissing(error)) return reply({ success: false, message: GIVING_MIGRATION_NOTE }, 503);
  console.error('[giving gifts manage]', error.message);
  return reply({ success: false, message: error.message || 'Something went wrong.' }, 500);
};

// "2026-11-26T15:30" typed in the dashboard is Philippine time.
function phDateTime(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  const d = new Date(m ? `${m[1]}T${m[2]}:00+08:00` : s);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getTime() > Date.now() + 86400000) return undefined;
  return d.toISOString();
}

// The dashboard's gift, checked, as the columns to write.
async function rowFrom(g) {
  const amount = parseAmount(g?.amount);
  if (!amount) return { error: 'Enter the amount.' };
  if (amount > MAX_AMOUNT) return { error: `That is more than ${peso(MAX_AMOUNT)}. Check the amount.` };
  let fund = String(g?.fund || '');
  let campaign = null;
  if (g?.campaign_id) {
    const { data } = await supabaseAdmin.from(CAMPAIGNS).select('id, title').eq('id', String(g.campaign_id)).maybeSingle();
    if (!data) return { error: 'That campaign is gone. Choose another.' };
    campaign = data;
    fund = 'Donation';
  }
  if (!isFund(fund)) return { error: 'Choose what the gift is for.' };

  let method = null;
  if (g?.method_id) {
    const { data } = await supabaseAdmin.from('payment_methods').select('id, name, category').eq('id', String(g.method_id)).maybeSingle();
    if (!data) return { error: 'That account is gone. Choose another.' };
    method = { id: data.id, name: data.name, category: data.category };
  } else {
    const name = plain(g?.method_name, 60);
    if (!name) return { error: 'Choose how the gift was given.' };
    method = { id: null, name, category: /card/i.test(name) ? 'card' : /cash/i.test(name) ? 'cash' : 'other' };
  }
  const last4 = String(g?.card_last4 || '').trim();
  if (last4 && !/^\d{4}$/.test(last4)) return { error: 'The card ending is its last 4 digits.' };
  const email = cleanEmail(g?.donor_email);
  if (email && !EMAIL_RE.test(email)) return { error: 'That email address does not look right.' };
  const givenAt = phDateTime(g?.given_at);
  if (givenAt === undefined) return { error: 'Check the date and time it was given.' };

  return {
    row: {
      donor_name: formatPersonName(plain(g?.donor_name, 100)) || null,
      donor_email: email || null,
      is_anonymous: g?.is_anonymous === true,
      amount,
      fund,
      campaign_id: campaign?.id || null,
      campaign_title: campaign?.title || null,
      method_id: method.id,
      method_name: method.name,
      method_category: method.category,
      card_last4: last4 || null,
      reference_no: plain(g?.reference_no, 40).toUpperCase() || null,
      message: note(g?.message, 500) || null,
      ...(givenAt ? { given_at: givenAt } : {}),
    },
  };
}

// The account with this email, so the gift shows in its My giving.
async function accountFor(email) {
  if (!email) return null;
  const { data } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
  return data?.id || null;
}

export async function GET(request) {
  const who = await givingAdmin(new URL(request.url).searchParams.get('actorId'));
  if (who.error) return denied(who);
  try {
    const [gifts, methods, campaigns] = await Promise.all([
      supabaseAdmin.from(GIFTS).select('*').order('given_at', { ascending: false }).limit(2000),
      supabaseAdmin.from('payment_methods').select('id, name, category, is_active').order('sort_order', { ascending: true }),
      supabaseAdmin.from(CAMPAIGNS).select('id, slug, title, ends_on, is_published').order('created_at', { ascending: false }),
    ]);
    if (gifts.error) throw gifts.error;
    return reply({
      success: true,
      data: (gifts.data || []).map((g) => ({ ...g, amount: Number(g.amount) || 0 })),
      methods: (methods.data || []).filter((m) => m.is_active !== false),
      campaigns: campaigns.data || [],
      emailReady: emailReady(),
    });
  } catch (error) { return trouble(error); }
}

// POST { actorId, gift }: a gift given in person, or one the treasurer found
// first. Successful unless said otherwise; the giver is emailed if asked.
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const who = await givingAdmin(body.actorId);
  if (who.error) return denied(who);
  try {
    const checked = await rowFrom(body.gift);
    if (checked.error) return reply({ success: false, message: checked.error }, 400);
    const status = body.gift?.status === 'pending' ? 'pending' : 'successful';
    const now = new Date().toISOString();
    const base = {
      ...checked.row,
      user_id: await accountFor(checked.row.donor_email),
      status,
      source: 'admin',
      recorded_by: who.user.id,
      recorded_by_name: who.name,
      ...(status === 'successful' ? { confirmed_at: now, confirmed_by: who.user.id, confirmed_by_name: who.name } : {}),
    };
    let saved = null;
    for (let i = 0; i < 4 && !saved; i += 1) {
      const { data, error } = await supabaseAdmin.from(GIFTS).insert({ ...base, receipt_no: newReceiptNo(), token: newToken() }).select('*').single();
      if (!error) { saved = data; break; }
      if (error.code !== '23505') throw error;
    }
    if (!saved) throw new Error('The gift could not be saved. Please try again.');
    await logGiving(who, 'giving_gift_record', saved.id, `Recorded a gift of ${peso(saved.amount)} (${saved.receipt_no})`);
    const email = status === 'successful' && body.gift?.send_email !== false && saved.donor_email ? await sendConfirmedEmail(saved) : null;
    forgetGiving();
    return reply({ success: true, data: { ...saved, amount: Number(saved.amount), email_sent_at: email?.sent ? now : saved.email_sent_at }, email });
  } catch (error) { return trouble(error); }
}

// PUT { actorId, id, action: confirm | fail | refund | reopen | resend, note? }
// PUT { actorId, id, gift }: corrected details
export async function PUT(request) {
  const body = await request.json().catch(() => ({}));
  const who = await givingAdmin(body.actorId);
  if (who.error) return denied(who);
  if (!body.id) return reply({ success: false, message: 'Which gift?' }, 400);
  try {
    const { data: gift, error: readError } = await supabaseAdmin.from(GIFTS).select('*').eq('id', body.id).maybeSingle();
    if (readError) throw readError;
    if (!gift) return reply({ success: false, message: 'That gift is gone.' }, 404);
    const now = new Date().toISOString();
    const why = plain(body.note, 300) || null;
    let patch;
    let log;

    if (body.action === 'resend') {
      if (gift.status !== 'successful') return reply({ success: false, message: 'Only a confirmed gift gets the thank-you email.' }, 409);
      const email = await sendConfirmedEmail(gift);
      if (email.sent) await logGiving(who, 'giving_gift_email', gift.id, `Sent the thank-you email again for ${gift.receipt_no}`);
      return reply({ success: true, data: { ...gift, amount: Number(gift.amount), email_sent_at: email.sent ? now : gift.email_sent_at }, email });
    }

    if (body.action === 'confirm') {
      if (gift.status === 'successful') return reply({ success: false, message: 'This gift is already confirmed.' }, 409);
      patch = { status: 'successful', confirmed_at: now, confirmed_by: who.user.id, confirmed_by_name: who.name, refunded_at: null, status_note: null };
      log = `Confirmed ${gift.receipt_no} (${peso(gift.amount)})`;
    } else if (body.action === 'fail') {
      if (gift.status !== 'pending') return reply({ success: false, message: 'Only a pending gift can be marked failed.' }, 409);
      patch = { status: 'failed', status_note: why };
      log = `Marked ${gift.receipt_no} failed`;
    } else if (body.action === 'refund') {
      if (gift.status !== 'successful') return reply({ success: false, message: 'Only a confirmed gift can be refunded.' }, 409);
      patch = { status: 'refunded', refunded_at: now, status_note: why };
      log = `Marked ${gift.receipt_no} refunded`;
    } else if (body.action === 'reopen') {
      patch = { status: 'pending', confirmed_at: null, confirmed_by: null, confirmed_by_name: null, refunded_at: null, status_note: null };
      log = `Put ${gift.receipt_no} back to pending`;
    } else if (body.gift) {
      const checked = await rowFrom(body.gift);
      if (checked.error) return reply({ success: false, message: checked.error }, 400);
      patch = checked.row;
      if (patch.donor_email !== gift.donor_email && !gift.user_id) patch.user_id = await accountFor(patch.donor_email);
      log = `Edited ${gift.receipt_no}`;
    } else {
      return reply({ success: false, message: 'Unknown action.' }, 400);
    }

    const { data, error } = await supabaseAdmin.from(GIFTS).update({ ...patch, updated_at: now }).eq('id', gift.id).select('*').single();
    if (error) throw error;
    await logGiving(who, `giving_gift_${body.action || 'edit'}`, gift.id, log);
    const email = body.action === 'confirm' && data.donor_email && body.sendEmail !== false ? await sendConfirmedEmail(data) : null;
    forgetGiving();
    return reply({ success: true, data: { ...data, amount: Number(data.amount), email_sent_at: email?.sent ? now : data.email_sent_at }, email });
  } catch (error) { return trouble(error); }
}

export async function DELETE(request) {
  const body = await request.json().catch(() => ({}));
  const who = await givingAdmin(body.actorId);
  if (who.error) return denied(who);
  try {
    const { data, error } = await supabaseAdmin.from(GIFTS).delete().eq('id', body.id).select('id, receipt_no, amount').maybeSingle();
    if (error) throw error;
    if (!data) return reply({ success: false, message: 'That gift is gone.' }, 404);
    await logGiving(who, 'giving_gift_delete', data.id, `Deleted ${data.receipt_no} (${peso(data.amount)})`);
    forgetGiving();
    return reply({ success: true });
  } catch (error) { return trouble(error); }
}
