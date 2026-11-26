'use client';

// Tithes & Offering, on the Sunday Service page (/sunday-service#give): one
// card with one button, which opens the giving steps in a window.

import { GiveButton } from './GiveModal';

export default function TithesCard() {
  return (
    <section id="give" className="gv-theme gv-tithes" aria-labelledby="gv-tithes-title">
      <img src="/heart-jar/gold-hearts/heart-gold.png" alt="" className="gv-tithes-heart" aria-hidden="true" />
      <div className="gv-tithes-text">
        <h3 id="gv-tithes-title">Tithes &amp; Offering</h3>
        <p>Give online by GCash, Maya or bank transfer. No account needed.</p>
      </div>
      <GiveButton mode="tithes" className="gv-btn is-primary">Give</GiveButton>
    </section>
  );
}
