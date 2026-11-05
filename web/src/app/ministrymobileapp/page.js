import Link from 'next/link';
import QRCode from 'qrcode';
import styles from './ministryApp.module.css';
import { getMinistryAppReleases, formatSize } from '@/lib/ministryAppRelease';
import { siteOrigin } from '@/lib/socialCard';

// /ministrymobileapp - where the Praise & Worship team downloads the
// JSCI Ministry app. The newest GitHub release is read every few minutes, so
// publishing a new version (ministry-app: npm run release) updates this page
// by itself - no website deploy needed.
export const revalidate = 300;

export const metadata = {
  title: 'JSCI Ministry App · Download for Android',
  description: 'The Praise & Worship team app of Joyful Sound Church: your Sunday lineups, songs, practice recordings, excuses, substitutes and attendance - in your pocket.',
  openGraph: {
    title: 'JSCI Ministry App',
    description: 'Lineups, songs, practice recordings, excuses and substitutes for the JSCI Praise & Worship team.',
    url: '/ministrymobileapp',
  },
};

const FEATURES = [
  { icon: 'fa-calendar-check', title: 'Your Sundays', text: 'See every date you serve - Song Leader, Backup Singer, Musician or Dancer - and who is on the team with you.' },
  { icon: 'fa-music', title: 'Lineup songs', text: 'Song Leaders add the slow and fast songs with YouTube links and notes. The whole team sees them at once.' },
  { icon: 'fa-microphone-lines', title: 'Practice recordings', text: 'Record your part on the phone or upload a file, and play back the team\'s practice audio anytime.' },
  { icon: 'fa-people-arrows', title: 'Excuse & substitute', text: 'File an excuse, ask for a substitute, or cover a teammate with one tap - and send a thank-you.' },
  { icon: 'fa-clipboard-check', title: 'Attendance', text: 'Your attendance rate and history, month by month.' },
  { icon: 'fa-fingerprint', title: 'Fingerprint lock', text: 'Keep the app locked with your fingerprint or Face ID.' },
  { icon: 'fa-circle-half-stroke', title: 'Light & dark', text: 'Follows your phone, or pick Light or Dark in Settings.' },
  { icon: 'fa-feather', title: 'Light on your phone', text: 'Small download, and it opens instantly from saved data - one quick refresh, no constant syncing.' },
];

const STEPS = [
  { icon: 'fa-download', title: 'Download', text: 'Tap "Download for Android" on your phone (or scan the QR code from a computer).' },
  { icon: 'fa-folder-open', title: 'Open the file', text: 'Open the downloaded jsci-ministry-app file from your notifications or Downloads.' },
  { icon: 'fa-shield-halved', title: 'Allow the install', text: 'If your phone asks, allow "Install unknown apps" for your browser. This is normal for apps outside the Play Store.' },
  { icon: 'fa-right-to-bracket', title: 'Sign in', text: 'Use the same email and password as the JSCI website.' },
];

const FAQ = [
  { q: 'Who can sign in?', a: 'Verified Ministry Members of Joyful Sound Church. If you cannot sign in, ask an admin to give your account the Ministry Member role with your Praise & Worship position.' },
  { q: 'I sign in to the website with Google. What is my password?', a: 'The app uses an email and password. Set a password for your account on the JSCI website first, then use it in the app.' },
  { q: 'How do I update the app?', a: 'The app tells you when a new version is out. Download it from this page and install it over the old one - you stay signed in.' },
  { q: 'Is there an iPhone version?', a: 'It is coming through Apple TestFlight. This page will show the iPhone link as soon as it is ready.' },
  { q: 'Is it safe to install?', a: 'Yes. The app is made by JSCI and published here; it only talks to the JSCI website. Android asks for permission because it is not from the Play Store.' },
];

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

// Release notes are short Markdown: "## headings", "- bullets", paragraphs.
function Notes({ text }) {
  const blocks = [];
  let list = null;
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (/^[-*]\s+/.test(line)) {
      if (!list) { list = []; blocks.push({ list, key: `l${i}` }); }
      list.push(line.replace(/^[-*]\s+/, ''));
      return;
    }
    list = null;
    if (!line) return;
    if (/^#{1,6}\s+/.test(line)) blocks.push({ heading: line.replace(/^#+\s+/, ''), key: `h${i}` });
    else blocks.push({ text: line, key: `p${i}` });
  });
  if (!blocks.length) return <p className={styles.muted}>Bug fixes and improvements.</p>;
  return (
    <div className={styles.notes}>
      {blocks.map((b) => (b.list
        ? <ul key={b.key}>{b.list.map((item, j) => <li key={j}>{item.replace(/\*\*/g, '')}</li>)}</ul>
        : b.heading ? <h4 key={b.key}>{b.heading}</h4> : <p key={b.key}>{b.text.replace(/\*\*/g, '')}</p>))}
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className={styles.phone} aria-hidden="true">
      <div className={styles.phoneNotch} />
      <div className={styles.phoneScreen}>
        <div className={styles.mockHero}>
          <span className={styles.mockKicker}>GOOD MORNING</span>
          <div className={styles.mockRow}>
            <span className={styles.mockAvatar}>JS</span>
            <div>
              <strong>Welcome!</strong>
              <div className={styles.mockChips}><span>Singer (PAW)</span><span>Musician</span></div>
            </div>
          </div>
          <p className={styles.mockVerse}>&ldquo;Sing to the Lord a new song.&rdquo; <em>Psalm 96:1</em></p>
        </div>
        <div className={styles.mockLabel}><i className="fas fa-calendar-check" /> Next up</div>
        <div className={`${styles.mockCard} ${styles.mockCardRaised}`}>
          <span className={styles.mockWhen}>THIS SUNDAY</span>
          <strong>Sunday, November 8</strong>
          <div className={styles.mockParts}><span className={styles.partLead}>Song Leader</span></div>
          <div className={styles.mockButtons}><span className={styles.mockBtnGold}><i className="fas fa-music" /> Add Songs</span><span className={styles.mockBtnGhost}>View Lineup</span></div>
        </div>
        <div className={styles.mockLabel}><i className="fas fa-calendar-week" /> Schedule</div>
        {[['SUN', '15', 'Backup Singer', styles.partBackup], ['SUN', '22', 'Keyboard', styles.partBand]].map(([dow, day, part, cls]) => (
          <div key={day} className={`${styles.mockCard} ${styles.mockLineup}`}>
            <span className={styles.mockDate}><small>{dow}</small>{day}</span>
            <div><span className={cls}>{part}</span><small className={styles.mockMeta}>4 songs · 7 on</small></div>
            <i className="fas fa-chevron-right" />
          </div>
        ))}
        <div className={styles.mockTabs}>
          <span className={styles.mockTabOn}><b><i className="fas fa-house" /></b>Home</span>
          <span><b><i className="fas fa-people-arrows" /></b>Excuse &amp; Sub</span>
          <span><b><i className="fas fa-clipboard-check" /></b>Attendance</span>
          <span><b><i className="fas fa-user" /></b>Profile</span>
        </div>
      </div>
    </div>
  );
}

export default async function MinistryMobileAppPage() {
  const releases = await getMinistryAppReleases();
  const latest = releases[0] || null;
  const older = releases.slice(1, 8);
  const downloadLink = `${siteOrigin()}/ministrymobileapp/download`;
  const qr = await QRCode.toString(downloadLink, { type: 'svg', margin: 1, width: 180, color: { dark: '#1a1a2eff', light: '#ffffffff' } }).catch(() => null);
  const totalDownloads = releases.reduce((n, r) => n + (r.apk.downloads || 0), 0);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <img src="/assets/LOGO.png" alt="" width={34} height={34} />
          <span>SanctuaryHub</span>
        </Link>
        <a href="#download" className={styles.topLink}><i className="fas fa-download" /> Get the app</a>
      </header>

      {/* ---- Hero ---- */}
      <section className={styles.hero} id="download">
        <div className={styles.glowA} />
        <div className={styles.glowB} />
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <span className={styles.eyebrow}><i className="fas fa-hands-praying" /> Praise &amp; Worship Team</span>
            <div className={styles.titleRow}>
              <img src="/assets/LOGO.png" alt="JSCI logo" className={styles.heroLogo} width={64} height={64} />
              <h1>JSCI Ministry</h1>
            </div>
            <p className={styles.lead}>
              Your Sunday lineups, songs, practice recordings, excuses and substitutes - all in one app made for the
              Praise &amp; Worship team of Joyful Sound Church.
            </p>

            {latest ? (
              <>
                <div className={styles.meta}>
                  <span><i className="fas fa-code-branch" /> Version {latest.version}</span>
                  <span><i className="fas fa-calendar" /> {fmtDate(latest.publishedAt)}</span>
                  {latest.apk.size ? <span><i className="fas fa-weight-hanging" /> {formatSize(latest.apk.size)}</span> : null}
                  <span><i className="fab fa-android" /> Android 7.0+</span>
                </div>
                <div className={styles.actions}>
                  <a href={latest.apk.url} download={latest.apk.name} className={styles.btnPrimary}>
                    <i className="fab fa-android" />
                    <span><small>Download for</small>Android</span>
                  </a>
                  <span className={styles.btnSoon} title="Coming soon through TestFlight">
                    <i className="fab fa-apple" />
                    <span><small>Coming soon for</small>iPhone</span>
                  </span>
                </div>
                <p className={styles.fileName}><i className="fas fa-file-arrow-down" /> {latest.apk.name}</p>
              </>
            ) : (
              <div className={styles.actions}>
                <span className={styles.btnSoon}><i className="fas fa-hourglass-half" /><span><small>Almost here</small>Coming soon</span></span>
              </div>
            )}
          </div>
          <PhoneMockup />
        </div>
      </section>

      {/* ---- Highlights ---- */}
      <section className={styles.strip}>
        <span><i className="fas fa-church" /> Made for JSCI</span>
        <span><i className="fas fa-ban" /> Free, no ads</span>
        <span><i className="fas fa-lock" /> Ministry Members only</span>
        {totalDownloads > 0 && <span><i className="fas fa-download" /> {totalDownloads.toLocaleString()} downloads</span>}
      </section>

      {/* ---- Features ---- */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>What&apos;s inside</span>
          <h2>Everything the team needs for Sunday</h2>
          <p className={styles.muted}>The same lineups, songs and requests as the website - in your pocket.</p>
        </div>
        <div className={styles.features}>
          {FEATURES.map((f) => (
            <article key={f.title} className={styles.feature}>
              <span className={styles.featureIcon}><i className={`fas ${f.icon}`} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- Install ---- */}
      <section className={styles.section}>
        <div className={styles.installGrid}>
          <div>
            <div className={styles.sectionHead} style={{ textAlign: 'left', marginLeft: 0 }}>
              <span className={styles.kicker}>Install</span>
              <h2>Ready in four steps</h2>
            </div>
            <ol className={styles.steps}>
              {STEPS.map((step, i) => (
                <li key={step.title}>
                  <span className={styles.stepNo}>{i + 1}</span>
                  <div>
                    <h3><i className={`fas ${step.icon}`} /> {step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <aside className={styles.qrCard}>
            <h3><i className="fas fa-qrcode" /> On a computer?</h3>
            <p className={styles.muted}>Scan with your phone&apos;s camera to download the latest version.</p>
            {qr && <div className={styles.qr} dangerouslySetInnerHTML={{ __html: qr }} />}
            <code className={styles.shortLink}>{downloadLink.replace(/^https?:\/\//, '')}</code>
          </aside>
        </div>
      </section>

      {/* ---- What's new ---- */}
      {latest && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>What&apos;s new</span>
            <h2>Version {latest.version}</h2>
            <p className={styles.muted}>Released {fmtDate(latest.publishedAt)}</p>
          </div>
          <div className={styles.releaseCard}>
            <Notes text={latest.notes} />
          </div>

          {older.length > 0 && (
            <div className={styles.history}>
              <h3>Earlier versions</h3>
              <ul>
                {older.map((r) => (
                  <li key={r.tag}>
                    <span className={styles.historyVersion}>v{r.version}</span>
                    <span className={styles.muted}>{fmtDate(r.publishedAt)}</span>
                    <span className={styles.muted}>{formatSize(r.apk.size)}</span>
                    <a href={r.apk.url} download={r.apk.name}><i className="fas fa-download" /> {r.apk.name}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ---- FAQ ---- */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>Questions</span>
          <h2>Good to know</h2>
        </div>
        <div className={styles.faq}>
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}<i className="fas fa-chevron-down" /></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <img src="/assets/LOGO.png" alt="" width={40} height={40} />
        <p><strong>Joyful Sound Church International</strong></p>
        <p className={styles.muted}>&ldquo;Make a joyful noise unto the Lord.&rdquo; Psalm 100:1</p>
        <Link href="/">Back to SanctuaryHub</Link>
      </footer>
    </main>
  );
}
