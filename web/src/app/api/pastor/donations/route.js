import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/actor';
import { churchDate, addDays } from '@/lib/ministryApp';
import { CAMPAIGNS, GIFTS, givingTablesMissing, GIVING_MIGRATION_NOTE, logGiving } from '@/lib/givingServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// GET /api/pastor/donations?actorId=..&scope=..&period=..
// The gifts behind a donation report (components/pastor/PastorReports):
// confirmed gifts only, donor names included, never e-mails, tokens or proofs.
//   scope   all | tithes (tithes and offerings) | drives (every donation
//           drive) | <campaign id>
//   period  month | last-month | year | 12m | all
// Without `scope`, only the drives (for the report's picker).
// Pastors and Admins (a Super Admin always may). Each export is written to the
// audit log, since the file names who gave.
// ============================================================

const ROLES = ['Pastor', 'Admin'];
const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const manila = (ymd) => new Date(`${ymd}T00:00:00+08:00`).toISOString();

// [from, to) as ISO times, and the words for the report.
function periodRange(period, today) {
  const [y, m] = today.split('-').map(Number);
  const first = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const monthName = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  switch (period) {
    case 'month': return { from: manila(first(y, m)), to: null, label: monthName(y, m) };
    case 'last-month': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: manila(first(py, pm)), to: manila(first(y, m)), label: monthName(py, pm) };
    }
    case 'year': return { from: manila(`${y}-01-01`), to: null, label: `${y} so far` };
    case '12m': return { from: manila(addDays(today, -364)), to: null, label: 'The last 12 months' };
    default: return { from: null, to: null, label: 'All time' };
  }
}

const bad = (message, status = 400) => NextResponse.json({ success: false, message }, { status });

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const who = await requireRole(params.get('actorId'), ROLES);
  if (who.error) return bad(who.error, who.status);

  try {
    const { data: campaigns, error: cErr } = await supabaseAdmin
      .from(CAMPAIGNS).select('id, title, goal_amount, ends_on, is_published').order('created_at', { ascending: false });
    if (cErr) throw cErr;
    const drives = (campaigns || []).map((c) => ({ id: c.id, title: c.title, goal: c.goal_amount != null ? Number(c.goal_amount) : null, endsOn: c.ends_on || null }));

    const scope = params.get('scope');
    if (!scope) return NextResponse.json({ success: true, drives }, { headers: { 'Cache-Control': 'private, no-store' } });

    let scopeLabel;
    if (scope === 'all') scopeLabel = 'All gifts';
    else if (scope === 'tithes') scopeLabel = 'Tithes and offerings';
    else if (scope === 'drives') scopeLabel = 'All donation drives';
    else if (UUID.test(scope)) {
      const drive = drives.find((d) => d.id === scope);
      if (!drive) return bad('That donation drive was not found.', 404);
      scopeLabel = drive.title;
    } else return bad('Pick what the report is for.');

    const range = periodRange(params.get('period'), churchDate());
    const build = () => {
      let q = supabaseAdmin.from(GIFTS)
        .select('id, receipt_no, donor_name, is_anonymous, amount, fund, campaign_title, method_name, reference_no, given_at')
        .eq('status', 'successful');
      if (scope === 'tithes') q = q.in('fund', ['Tithes', 'Offering']);
      else if (scope === 'drives') q = q.not('campaign_id', 'is', null);
      else if (scope !== 'all') q = q.eq('campaign_id', scope);
      if (range.from) q = q.gte('given_at', range.from);
      if (range.to) q = q.lt('given_at', range.to);
      return q.order('given_at', { ascending: true }).order('id', { ascending: true });
    };
    const gifts = [];
    for (let from = 0; from < 100 * PAGE; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      gifts.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }

    await logGiving(who, 'export_gifts', UUID.test(scope) ? scope : null, {
      scope: scopeLabel, period: range.label, gifts: gifts.length, by: 'pastor report',
    });

    return NextResponse.json({
      success: true,
      drives,
      scopeLabel,
      periodLabel: range.label,
      gifts: gifts.map((g) => ({
        at: g.given_at,
        receipt: g.receipt_no,
        donor: (g.donor_name || '').trim() || 'No name given',
        anonymous: !!g.is_anonymous,
        amount: Number(g.amount) || 0,
        fund: g.fund,
        drive: g.campaign_title || null,
        method: g.method_name || '',
        reference: g.reference_no || '',
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (givingTablesMissing(error)) return bad(GIVING_MIGRATION_NOTE, 503);
    console.error('pastor donations:', error?.message || error);
    return bad('The donations could not be loaded just now.', 500);
  }
}
