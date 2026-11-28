import { GivingShell, givingMetadata } from '@/components/giving/givingPage';
import GivingJar from '@/components/giving/GivingJar';
import DriveCard from '@/components/giving/DriveCard';
import { TITHES_PATH } from '@/lib/giving';
import { openCampaigns, safely } from '@/lib/givingServer';

// /donation - the church's donation drives, each with its jar. Choose one to
// see its photos and donate. (Tithes and offerings are given on the Sunday
// Service page.) Refreshed every minute, and at once when a drive changes.

export const revalidate = 60;

export function generateMetadata() {
  return givingMetadata({
    title: 'Donate',
    description: 'Help the church\'s donation drives, by GCash, Maya or bank transfer. Every donation fills the jar.',
    path: '/donation',
  });
}

// Each drive's card: its jar fills and its gold bar with it as it scrolls
// into view (components/giving/DriveCard).

export default async function DonationPage() {
  const drives = await safely(openCampaigns, []);
  return (
    <GivingShell path="/donation">
      <header className="gv-head is-outreach">
        <div className="gv-wrap">
          <span className="gv-eyebrow">Donate</span>
          <h1>Help fill the jar</h1>
          <p>Choose a cause. Every donation drops hearts into its jar.</p>
        </div>
      </header>
      <main className="gv-main">
        <div className="gv-wrap gv-rise">
          {drives.length ? (
            <div className={`gv-drives ${drives.length === 1 ? 'is-one' : ''}`}>
              {drives.map((c) => <DriveCard key={c.id} c={c} />)}
            </div>
          ) : (
            <section className="gv-card gv-empty-drive">
              <GivingJar amount={0} isStatic label="An empty jar" />
              <h2>No donation drive right now</h2>
              <p>When the church starts one, it shows here with its jar.</p>
            </section>
          )}
          <p className="gv-aside-note">Giving your tithes or offering? <a href={TITHES_PATH}>Give on the Sunday Service page</a></p>
        </div>
      </main>
    </GivingShell>
  );
}
