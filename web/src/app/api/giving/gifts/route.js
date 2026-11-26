import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { clientIp, limit, tooManyRequests } from '@/lib/rateLimiter';
import { isUuid, NO_STORE } from '@/lib/watchAccess';
import { formatPersonName } from '@/lib/eventFormat';
import { EMAIL_RE, MAX_AMOUNT, MIN_AMOUNT, campaignOpen, isFund, parseAmount, peso } from '@/lib/giving';
import {
  GIFTS, GIVING_MIGRATION_NOTE, campaignNow, cleanEmail, forgetGiving, giftByToken, giftView, givingMethods, givingTablesMissing,
  newReceiptNo, newToken, note, plain, publishedCampaigns,
} from '@/lib/givingServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROOF_TYPES = /^(image\/|application\/pdf$)/;
const PROOF_MAX = 4 * 1024 * 1024;
// GCash and Maya references are 13 digits; banks add letters and dashes.
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{3,39}$/;

const fail = (message, status = 400, extra = {}) => NextResponse.json({ success: false, message, ...extra }, { status, headers: NO_STORE });

// POST /api/giving/gifts  (multipart, with an optional `proof` screenshot, or JSON)
//   { amount, fund, campaignId?, methodId, reference, name?, email, anonymous?, message?, userId? }
// Somebody has sent a gift to one of the church's accounts and tells us so:
// a tithe or an offering (from the Sunday Service page), or a donation to one
// of the drives (from its page on /donation). It is pending until the
// treasurer finds it; then they are emailed.
export async function POST(request) {
  try {
    const type = request.headers.get('content-type') || '';
    let body = {};
    let proof = null;
    if (type.includes('multipart/form-data')) {
      const form = await request.formData();
      for (const [k, v] of form.entries()) if (k !== 'proof') body[k] = v;
      const file = form.get('proof');
      if (file && typeof file === 'object' && file.size > 0) proof = file;
    } else {
      body = await request.json().catch(() => ({}));
    }

    const ip = clientIp(request);
    const byIp = await limit(`giving:ip:${ip}`, 10, 10 * 60 * 1000, { shared: true });
    if (!byIp.allowed) return tooManyRequests(byIp.retryAfterSec, 'Several gifts were sent from here just now. Please wait a few minutes, then try again.');

    // ---- Who is giving ----
    let user = null;
    if (body.userId && isUuid(body.userId)) {
      const { data } = await supabaseAdmin.from('users').select('id, firstname, lastname, email, is_active').eq('id', String(body.userId)).maybeSingle();
      if (data && data.is_active !== false) user = data;
    }
    const email = cleanEmail(user?.email || body.email);
    if (!EMAIL_RE.test(email)) return fail('Please enter your email address, so we can tell you when your gift is confirmed.');
    const byEmail = await limit(`giving:email:${email}`, 8, 60 * 60 * 1000, { shared: true });
    if (!byEmail.allowed) return tooManyRequests(byEmail.retryAfterSec, 'Several gifts were sent with this email just now. Please wait a little, then try again.');

    const anonymous = body.anonymous === true || body.anonymous === 'true';
    // "jose cruz" is kept as "Jose Cruz", as names are everywhere on the site.
    const name = formatPersonName(plain(body.name || (user ? `${user.firstname || ''} ${user.lastname || ''}` : ''), 100)) || null;

    // ---- The gift ----
    const amount = parseAmount(body.amount);
    if (!amount || amount < MIN_AMOUNT) return fail('Please enter the amount you sent.');
    if (amount > MAX_AMOUNT) return fail(`For a gift over ${peso(MAX_AMOUNT)}, please message the church office.`);

    let fund = String(body.fund || '');
    let campaign = null;
    if (body.campaignId) {
      campaign = (await publishedCampaigns()).find((c) => c.id === String(body.campaignId)) || null;
      if (!campaign || !campaignOpen(campaign)) return fail('That appeal is no longer taking gifts. Please choose another.', 409);
      fund = 'Donation';
    }
    if (!isFund(fund)) return fail('Please choose what your gift is for: Tithes or Offering.');
    if (fund === 'Donation' && !campaign) return fail('Please choose the donation drive you are giving to.');

    // ---- Where it was sent ----
    const methods = await givingMethods();
    const method = methods.find((m) => m.id === String(body.methodId || ''));
    if (!method) return fail('Please choose the account you sent your gift to.');
    const reference = plain(body.reference, 40).toUpperCase();
    if (!REF_RE.test(reference)) return fail(`Please enter the reference number from your ${method.name} receipt.`);

    // The same transfer told twice (a double tap, a second try): the first is kept.
    const { data: twins, error: twinError } = await supabaseAdmin
      .from(GIFTS).select('*').eq('reference_no', reference).eq('method_name', method.name).neq('status', 'failed').limit(5);
    if (twinError) {
      if (givingTablesMissing(twinError)) return fail(GIVING_MIGRATION_NOTE, 503);
      throw twinError;
    }
    const mine = (twins || []).find((g) => cleanEmail(g.donor_email) === email);
    if (mine) return NextResponse.json({ success: true, repeat: true, data: giftView(mine, { fullEmail: true }), hasAccount: !!user || await emailHasAccount(email) }, { headers: NO_STORE });
    if ((twins || []).length) return fail(`A gift with this ${method.name} reference number was already sent to us. If this is a different transfer, check the number on your receipt.`, 409);

    let proofUrl = null;
    if (proof) {
      if (!PROOF_TYPES.test(proof.type || '')) return fail('The screenshot must be a picture or a PDF.');
      if (proof.size > PROOF_MAX) return fail('That screenshot is larger than 4 MB. Try a smaller one, or leave it out.', 413);
      const up = await uploadBufferToCloudinary(await proof.arrayBuffer(), {
        fileName: proof.name || 'giving-proof',
        mimeType: proof.type,
        folder: 'JSCI-System/giving/proofs',
        resourceType: 'auto',
      });
      proofUrl = up.secureUrl;
    }

    const row = {
      user_id: user?.id || null,
      donor_name: name,
      donor_email: email,
      is_anonymous: anonymous,
      amount,
      fund,
      campaign_id: campaign?.id || null,
      campaign_title: campaign?.title || null,
      method_id: method.id,
      method_name: method.name,
      method_category: method.category,
      reference_no: reference,
      proof_url: proofUrl,
      message: note(body.message, 500) || null,
      status: 'pending',
      source: 'online',
      given_at: new Date().toISOString(),
    };

    // A receipt number is random; on the rare clash, another one.
    let saved = null;
    for (let i = 0; i < 4 && !saved; i += 1) {
      const { data, error } = await supabaseAdmin.from(GIFTS).insert({ ...row, receipt_no: newReceiptNo(), token: newToken() }).select('*').single();
      if (!error) { saved = data; break; }
      if (givingTablesMissing(error)) return fail(GIVING_MIGRATION_NOTE, 503);
      if (error.code !== '23505') throw error;
    }
    if (!saved) throw new Error('The gift could not be saved. Please try again.');

    forgetGiving();
    return NextResponse.json({
      success: true,
      data: giftView(saved, { fullEmail: true }),
      hasAccount: !!user || await emailHasAccount(email),
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('[giving gift]', error.message);
    return fail('Your gift details could not be sent. Please try again in a moment.', 500);
  }
}

async function emailHasAccount(email) {
  const { data } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
  return !!data;
}

// GET /api/giving/gifts?token=..              -> one gift, and for a donation its
//                                                drive's jar as it is now
// GET /api/giving/gifts?userId=..&email=..    -> every gift in this account (My giving)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    if (token) {
      const gift = await giftByToken(token);
      if (!gift) return fail('We could not find that gift.', 404);
      const campaign = gift.campaign_id ? await campaignNow(gift.campaign_id).catch(() => null) : null;
      return NextResponse.json({ success: true, data: giftView(gift), campaign }, { headers: NO_STORE });
    }

    const userId = searchParams.get('userId');
    const email = cleanEmail(searchParams.get('email'));
    if (!isUuid(userId)) return fail('Please sign in to see your giving.', 401);
    const { data: user } = await supabaseAdmin.from('users').select('id, email, is_active').eq('id', userId).maybeSingle();
    // The account's own email as well as its id: a little more than an id alone.
    if (!user || user.is_active === false || cleanEmail(user.email) !== email) return fail('Please sign in again to see your giving.', 403);

    const { data, error } = await supabaseAdmin.from(GIFTS).select('*').eq('user_id', user.id).order('given_at', { ascending: false }).limit(500);
    if (error) {
      if (givingTablesMissing(error)) return NextResponse.json({ success: true, data: [] }, { headers: NO_STORE });
      throw error;
    }
    return NextResponse.json({ success: true, data: (data || []).map((g) => giftView(g, { fullEmail: true })) }, { headers: NO_STORE });
  } catch (error) {
    console.error('[giving gifts]', error.message);
    return fail('Your giving could not be loaded. Please try again.', 500);
  }
}
