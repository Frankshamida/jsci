import { GivingShell, givingMetadata } from '@/components/giving/givingPage';
import GivingJar from '@/components/giving/GivingJar';
import { TITHES_PATH, campaignEnds, campaignPath, jarProps, peso } from '@/lib/giving';
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

function DriveCard({ c }) {
  const goal = Number(c.goal_amount) || 0;
  const percent = goal ? Math.round((c.raised / goal) * 100) : 0;
  const ends = campaignEnds(c);
  return (
    <a href={campaignPath(c.slug)} className="gv-card gv-drive">
      {c.image_url && (
        <div className="gv-drive-media" aria-hidden="true">
          <img src={c.image_url} alt="" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="gv-drive-body">
        {/* Small and still; put on the page as it scrolls into view. */}
        <div className="gv-drive-jar" aria-hidden="true"><GivingJar {...jarProps(c)} isStatic keepSize lazy label="" /></div>
        <div className="gv-drive-text">
          <strong>{c.title}</strong>
          {c.summary && <span className="gv-drive-sum">{c.summary}</span>}
          {goal > 0 && <span className="gv-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(percent, c.raised > 0 ? 2 : 0))}%` }}></span></span>}
          <span className="gv-drive-amount">
            {c.raised > 0
              ? <><b>{peso(c.raised)}</b>{goal ? ` of ${peso(goal)}` : ` from ${c.gifts} ${c.gifts === 1 ? 'donation' : 'donations'}`}</>
              : 'Be the first to give'}
            {ends ? ` · ${ends}` : ''}
          </span>
        </div>
      </div>
    </a>
  );
}

export default async function DonationPage() {
  const drives = await safely(openCampaigns, []);
  return (
    <GivingShell path="/donation">
      <header className="gv-head">
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
