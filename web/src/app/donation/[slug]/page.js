import { notFound } from 'next/navigation';
import { GivingShell, givingMetadata } from '@/components/giving/givingPage';
import DonationGallery from '@/components/giving/DonationGallery';
import DonationJar from '@/components/giving/DonationJar';
import { campaignPath } from '@/lib/giving';
import { publishedCampaigns, safely } from '@/lib/givingServer';

// /donation/<slug> - one donation drive: its photos, its story, and its jar
// with Donate. A drive that has ended keeps its page (and its full jar); a
// hidden or deleted one is not found.
//
// ?gift=<token> (the "your donation is confirmed" email): the giver's hearts
// drop into the jar - see components/giving/DonationJar.

export const revalidate = 60;
export function generateStaticParams() { return []; }

const findDrive = async (slug) => (await safely(publishedCampaigns, [])).find((c) => c.slug === slug) || null;

export async function generateMetadata({ params }) {
  const c = await findDrive(params.slug);
  if (!c) return { title: 'Donate' };
  return givingMetadata({
    title: c.title,
    description: c.summary || `Donate to ${c.title}, by GCash, Maya or bank transfer.`,
    path: campaignPath(c.slug),
    image: c.image_url || null,
  });
}

export default async function DrivePage({ params }) {
  const drive = await findDrive(params.slug);
  if (!drive) notFound();

  return (
    <GivingShell path={campaignPath(drive.slug)}>
      <header className="gv-head">
        <div className="gv-wrap">
          <a href="/donation" className="gv-crumb">Donate</a>
          <h1>{drive.title}</h1>
          {drive.summary && <p>{drive.summary}</p>}
        </div>
      </header>
      <main className="gv-main">
        <div className={`gv-wrap gv-drive-layout ${drive.images.length ? '' : 'no-photos'}`}>
          {drive.images.length > 0 && (
            <div className="gv-card gv-drive-photos">
              <DonationGallery images={drive.images} title={drive.title} />
            </div>
          )}
          <aside className="gv-drive-side" aria-label="The jar">
            <DonationJar campaign={drive} />
          </aside>
          {drive.story && (
            <section className="gv-card gv-drive-story" aria-labelledby="gv-story-title">
              <h2 id="gv-story-title">About this drive</h2>
              <p className="gv-story">{drive.story}</p>
            </section>
          )}
        </div>
      </main>
    </GivingShell>
  );
}
