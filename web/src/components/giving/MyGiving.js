'use client';

// My giving (/giving/my): the signed-in account's gifts - the totals, then
// every gift with its date and time, amount, what it was for, how it was sent,
// its status, its reference number and its receipt.

import { useViewer } from '@/lib/viewer';
import { useMyGifts, givingTotals } from '@/lib/givingClient';
import { DONATION_PATH, MY_GIVING_PATH, TITHES_PATH, STATUSES, fundLabel, giftDate, giftTime, methodLabel, peso, phYear, receiptPath, statusLabel } from '@/lib/giving';

function Gate() {
  return (
    <section className="gv-card gv-form gv-closed">
      <h2>Sign in to see your giving</h2>
      <p className="gv-sub">Your gifts and their receipts are kept in your account. No account? You can still give - and make one afterwards to keep track.</p>
      <div className="gv-actions" style={{ justifyContent: 'center' }}>
        <a href={TITHES_PATH} className="gv-btn">Give without an account</a>
        <a href={`/login?next=${encodeURIComponent(MY_GIVING_PATH)}`} className="gv-btn is-primary">Sign in</a>
      </div>
    </section>
  );
}

// A way to give: a link to the public page, or - inside the dashboard, which
// passes onGive - a button that opens its own Give tab instead.
function GiveLink({ kind, onGive, className, children }) {
  if (onGive) return <button type="button" className={className} onClick={() => onGive(kind)}>{children}</button>;
  return <a href={kind === 'donation' ? DONATION_PATH : TITHES_PATH} className={className}>{children}</a>;
}

export default function MyGiving({ onGive } = {}) {
  const { viewer, ready } = useViewer();
  const { gifts, loading, error, reload } = useMyGifts(ready ? viewer : null);
  const year = phYear();
  const totals = givingTotals(gifts, year);

  if (!ready) return <section className="gv-card gv-form gv-closed"><span className="gv-spinner" aria-label="Loading"></span></section>;
  if (!viewer) return <Gate />;

  return (
    <>
      <div className="gv-stats">
        <div className="gv-card gv-stat"><strong>{peso(totals.given)}</strong><span>Given in {year}, confirmed</span></div>
        <div className="gv-card gv-stat"><strong>{totals.pending}</strong><span>Waiting to be confirmed</span></div>
        <div className="gv-card gv-stat"><strong>{gifts.length}</strong><span>{gifts.length === 1 ? 'Gift' : 'Gifts'} in all</span></div>
      </div>

      <section className="gv-card gv-list" aria-labelledby="gv-my-title">
        <div className="gv-list-head">
          <h2 id="gv-my-title">Your gifts</h2>
          <span className="gv-list-btns">
            <GiveLink kind="tithes" onGive={onGive} className="gv-btn is-small">Tithes &amp; offering</GiveLink>
            <GiveLink kind="donation" onGive={onGive} className="gv-btn is-primary is-small">Donate</GiveLink>
          </span>
        </div>
        {loading ? (
          <div className="gv-empty"><span className="gv-spinner" aria-label="Loading"></span></div>
        ) : error ? (
          <div className="gv-empty">
            <strong>Your giving could not be loaded</strong>
            {error}
            <div><button type="button" className="gv-btn" onClick={reload}>Try again</button></div>
          </div>
        ) : gifts.length === 0 ? (
          <div className="gv-empty">
            <strong>No gifts yet</strong>
            Gifts you send while signed in, or with this account&apos;s email, show here.
            <div><GiveLink kind="tithes" onGive={onGive} className="gv-btn is-primary">Give</GiveLink></div>
          </div>
        ) : (
          <table className="gv-table">
            <thead>
              <tr>
                <th scope="col">Date and time</th>
                <th scope="col">Amount</th>
                <th scope="col">For</th>
                <th scope="col">Payment method</th>
                <th scope="col">Status</th>
                <th scope="col">Reference</th>
                <th scope="col"><span className="gv-visually-hidden">Receipt</span></th>
              </tr>
            </thead>
            <tbody>
              {gifts.map((g) => (
                <tr key={g.receipt_no}>
                  <td>{giftDate(g.given_at)}<small>{giftTime(g.given_at)}</small></td>
                  <td><strong>{peso(g.amount)}</strong></td>
                  <td data-wide>{fundLabel(g)}</td>
                  <td>{methodLabel(g)}</td>
                  <td><span className={`gv-status ${STATUSES[g.status]?.tone || 'warn'}`}>{statusLabel(g.status)}</span></td>
                  <td className="gv-mono">{g.reference_no || '—'}<small>{g.receipt_no}</small></td>
                  {/* Inside the dashboard (onGive), the receipt opens beside it. */}
                  <td><a href={receiptPath(g.token)} {...(onGive ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>View receipt</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
