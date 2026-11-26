import { GivingShell, givingMetadata } from '@/components/giving/givingPage';
import MyGiving from '@/components/giving/MyGiving';

// /giving/my - every gift in the signed-in account: when, how much, what
// for, how it was sent, where it stands, its reference number and receipt.

export function generateMetadata() {
  return givingMetadata({ title: 'My giving', description: 'Your gifts to the church, and their receipts.', path: '/giving/my', noindex: true });
}

export default function MyGivingPage() {
  return (
    <GivingShell path="/giving/my">
      <header className="gv-head">
        <div className="gv-wrap">
          <span className="gv-eyebrow" style={{ display: 'block' }}>My giving</span>
          <h1>Your gifts, and their receipts</h1>
          <p>Every gift you send shows here, from the moment you send it until the treasurer confirms it.</p>
        </div>
      </header>
      <main className="gv-main">
        <div className="gv-wrap" style={{ marginTop: -96, position: 'relative' }}>
          <MyGiving />
        </div>
      </main>
    </GivingShell>
  );
}
