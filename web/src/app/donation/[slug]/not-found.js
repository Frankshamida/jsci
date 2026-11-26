import { GivingShell } from '@/components/giving/givingPage';

export default function DriveNotFound() {
  return (
    <GivingShell path="/donation">
      <header className="gv-head">
        <div className="gv-wrap">
          <span className="gv-eyebrow">Donate</span>
          <h1>That drive is not here</h1>
          <p>It may have ended or been renamed.</p>
        </div>
      </header>
      <main className="gv-main">
        <div className="gv-wrap gv-rise">
          <section className="gv-card gv-empty-drive">
            <div className="gv-actions is-center"><a href="/donation" className="gv-btn is-primary">See the donation drives</a></div>
          </section>
        </div>
      </main>
    </GivingShell>
  );
}
