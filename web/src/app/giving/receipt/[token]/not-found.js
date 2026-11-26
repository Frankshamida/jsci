import { GivingShell } from '@/components/giving/givingPage';

export default function ReceiptNotFound() {
  return (
    <GivingShell path="/giving/my">
      <header className="gv-head">
        <div className="gv-wrap gv-narrow">
          <span className="gv-eyebrow">Receipt</span>
          <h1>We could not find that receipt</h1>
          <p>Check that the whole link was copied. If you have the receipt number, message the church and we will look it up.</p>
        </div>
      </header>
      <main className="gv-main">
        <div className="gv-wrap gv-narrow" style={{ marginTop: -96, position: 'relative' }}>
          <section className="gv-card gv-form gv-closed">
            <div className="gv-actions" style={{ justifyContent: 'center', marginTop: 0 }}>
              <a href="/giving/my" className="gv-btn">My giving</a>
              <a href="/donation" className="gv-btn is-primary">Donate</a>
            </div>
          </section>
        </div>
      </main>
    </GivingShell>
  );
}
