import { notFound } from 'next/navigation';
import { GivingShell, givingMetadata } from '@/components/giving/givingPage';
import { PrintButton } from '@/components/giving/ReceiptActions';
import { MY_GIVING_PATH, STATUSES, fundLabel, giftWhen, jarPath, methodLabel, peso, statusLabel } from '@/lib/giving';
import { campaignNow, giftByToken, giftView, safely } from '@/lib/givingServer';
import { brandFor } from '@/lib/branding';
import { readBranding } from '@/lib/brandingServer';

// /giving/receipt/<token> - one gift's receipt: the link in the thank-you
// email, on the thank-you screen and in My giving. Anyone with the link can
// open it (it is a long secret, never listed), so the email on it is
// partly hidden. Not cached, so it always says where the gift stands.

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return givingMetadata({ title: 'Giving receipt', description: 'A receipt for a gift to the church.', path: '/giving', noindex: true });
}

const BANNERS = {
  pending: { tone: 'warn', text: 'This gift is waiting for the church treasurer to match it with the church\'s account. You will be emailed when it is confirmed.' },
  failed: { tone: 'bad', text: 'This transfer did not show up in the church\'s account. If you sent it, message us with the reference number below.' },
  refunded: { tone: 'off', text: 'This gift was given back to you.' },
};

export default async function ReceiptPage({ params }) {
  const row = await safely(() => giftByToken(params.token), null);
  if (!row) notFound();
  const g = giftView(row);
  const brand = brandFor(await safely(readBranding, null));
  const banner = BANNERS[g.status];
  // A confirmed donation can be seen in its drive's jar.
  const drive = row.campaign_id && g.status === 'successful' ? await safely(() => campaignNow(row.campaign_id), null) : null;

  return (
    <GivingShell path="/giving/my">
      <header className="gv-head">
        <div className="gv-wrap gv-narrow">
          <a href={MY_GIVING_PATH} className="gv-crumb gv-noprint">My giving</a>
          <span className="gv-eyebrow" style={{ display: 'block' }}>Receipt</span>
          <h1>Thank you for your gift</h1>
        </div>
      </header>
      <main className="gv-main">
        <div className="gv-wrap gv-narrow" style={{ marginTop: -96, position: 'relative' }}>
          <article className="gv-card gv-receipt">
            <div className="gv-receipt-top">
              <div className="gv-receipt-brand">
                <img src="/assets/LOGO.png" alt="" />
                <div>
                  <strong>{brand.church}</strong>
                  <span>Giving receipt</span>
                </div>
              </div>
              <span className={`gv-status ${STATUSES[g.status]?.tone || 'warn'}`}>{statusLabel(g.status)}</span>
            </div>

            <p className="gv-receipt-amount">{peso(g.amount)}</p>
            <p className="gv-sub" style={{ marginTop: 0 }}>{fundLabel(g)}</p>

            {banner && <p className={`gv-banner ${banner.tone}`}>{banner.text}{g.status_note ? ` ${g.status_note}` : ''}</p>}

            <dl className="gv-rows">
              <div><dt>Receipt number</dt><dd className="gv-mono">{g.receipt_no}</dd></div>
              <div><dt>Date and time</dt><dd>{giftWhen(g.given_at)}</dd></div>
              <div><dt>Received from</dt><dd>{g.donor_name || 'Anonymous'}</dd></div>
              {g.donor_email && <div><dt>Email</dt><dd>{g.donor_email}</dd></div>}
              <div><dt>Fund or purpose</dt><dd>{fundLabel(g)}</dd></div>
              <div><dt>Payment method</dt><dd>{methodLabel(g)}</dd></div>
              <div><dt>Reference number</dt><dd className="gv-mono">{g.reference_no || '—'}</dd></div>
              <div><dt>Status</dt><dd>{statusLabel(g.status)}</dd></div>
              {g.confirmed_at && g.status !== 'pending' && <div><dt>Confirmed</dt><dd>{giftWhen(g.confirmed_at)}</dd></div>}
              {g.refunded_at && <div><dt>Refunded</dt><dd>{giftWhen(g.refunded_at)}</dd></div>}
            </dl>

            <p className="gv-receipt-foot">
              Quote the receipt number, {g.receipt_no}, if you ever ask us about this gift. Match the reference
              number with your {g.method_name} or bank history. This is an acknowledgement of your gift from {brand.church}.
            </p>

            <div className="gv-actions gv-noprint">
              {drive?.is_published && <a href={jarPath(drive.slug, g.token)} className="gv-btn">See it in the jar</a>}
              <PrintButton />
            </div>
          </article>
        </div>
      </main>
    </GivingShell>
  );
}
