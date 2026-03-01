'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import './home.css';

// ============================================
// DATA
// ============================================
const HERO_SLIDES = [
  { img: '/assets/worship-service.jpg', title: 'Experience God\'s Presence', sub: 'Join us every Sunday for a powerful time of worship and the Word' },
  { img: '/assets/community-outreach.jpg', title: 'Reaching Our Community', sub: 'Extending God\'s love through service and outreach to those in need' },
  { img: '/assets/youth-event.jpg', title: 'Empowering the Next Generation', sub: 'Dynamic youth programs for spiritual growth and fun fellowship' },
  { img: '/assets/christian-leadership-conference.jpg', title: 'Raising Up Leaders', sub: 'Equipping believers for effective ministry and leadership' },
  { img: '/assets/baptism-service.jpg', title: 'New Life in Christ', sub: 'Celebrating lives transformed through faith and baptism' },
];

const PASTORS = [
  { name: 'Dr. Weldon Pior', title: 'Senior Pastor', photo: '/assets/dr-weldon-pior.png' },
  { name: 'Dr. Dorothy Pior', title: 'Senior Pastor', photo: '/assets/dr-dorothy-pior.png' },
  { name: 'Ptr. Gracelyn Gambe', title: 'Associate Pastor', photo: '/assets/ptr-gracelyn-gambe.png' },
  { name: 'Ptr. Eldan Gambe', title: 'Associate Pastor', photo: '/assets/ptr-eldan-gambe.png' },
  { name: 'Ptr. Psalm Gambe', title: 'Youth Pastor', photo: '/assets/ptr-psalm-gambe.png' },
];

const ACTIVITIES = [
  { title: 'Sunday Worship Service', desc: 'Our church family united in powerful worship and biblical teaching every Sunday morning.', photo: '/assets/worship-service.jpg', badge: 'Weekly' },
  { title: 'Friday Bible Study', desc: 'In-depth Bible study and discussion for spiritual growth and deeper understanding of God\'s Word.', photo: '/assets/friday-bible-study.jpg', badge: 'Weekly' },
  { title: 'ISOM Training', desc: 'International School of Ministry — equipping leaders for effective kingdom work and ministry.', photo: '/assets/isom-training.jpg', badge: 'Ongoing' },
  { title: 'Youth Ministry', desc: 'Dynamic gatherings filled with fun, fellowship, games, and spiritual growth for the youth.', photo: '/assets/youth-event.jpg', badge: 'Monthly' },
  { title: 'Community Outreach', desc: 'Serving our community with practical needs and sharing the good news of Jesus Christ.', photo: '/assets/community-outreach.jpg', badge: 'Quarterly' },
  { title: 'Pastor Appreciation', desc: 'Honoring and celebrating our dedicated pastors for their faithful service and leadership.', photo: '/assets/pastor-appreciation.jpg', badge: 'Annual' },
];

const SERVICE_TIMES = [
  { icon: 'fa-sun', day: 'Sunday', time: '9:00 AM', name: 'Worship Service' },
  { icon: 'fa-book-bible', day: 'Friday', time: '7:00 PM', name: 'Bible Study' },
  { icon: 'fa-users', day: 'Saturday', time: '2:00 PM', name: 'Youth Fellowship' },
];

const NEWS_ITEMS = [
  { title: 'Upcoming Baptism Service', date: 'March 15, 2026', desc: 'Join us for a special baptism service. If you\'d like to be baptized, please register at the church office.', icon: 'fa-water' },
  { title: 'Easter Celebration', date: 'April 5, 2026', desc: 'A grand celebration of the resurrection of our Lord Jesus Christ with special music and drama presentations.', icon: 'fa-cross' },
  { title: 'Leadership Conference 2026', date: 'May 10-12, 2026', desc: 'Three-day conference on "Raising Kingdom Leaders" — open to all church members and partners.', icon: 'fa-graduation-cap' },
  { title: 'VBS – Vacation Bible School', date: 'June 2026', desc: 'A week of fun, games, worship, and Bible lessons for kids ages 5-12. Volunteers needed!', icon: 'fa-children' },
];

const GROQ_API_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ============================================
// COMPONENT
// ============================================
export default function HomePage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [heroIndex, setHeroIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(false);
  const [dailyVerse, setDailyVerse] = useState({ verse: '', reference: '' });
  const heroTimer = useRef(null);

  // ---- Check logged in ----
  useEffect(() => {
    const userData = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}');
    if (userData && userData.firstname && userData.email) {
      router.replace('/dashboard');
      return;
    }
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(saved);
    if (saved) document.body.classList.add('dark-mode');
  }, [router]);

  // ---- Hero auto-rotate ----
  useEffect(() => {
    heroTimer.current = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => clearInterval(heroTimer.current);
  }, []);

  // ---- Scroll listener ----
  useEffect(() => {
    const handleScroll = () => {
      setScrollTop(window.scrollY > 400);
      // Intersection-style animation
      document.querySelectorAll('.hp-animate:not(.visible)').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight - 80) {
          el.classList.add('visible');
        }
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    // Trigger once on mount
    setTimeout(handleScroll, 300);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // ---- Daily verse ----
  const fetchDailyVerse = useCallback(async () => {
    if (!GROQ_API_KEY) {
      setDailyVerse({ verse: '"For I know the plans I have for you," declares the Lord, "plans to prosper you and not to harm you, plans to give you hope and a future."', reference: 'Jeremiah 29:11 (NIV)' });
      return;
    }
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: 'You are a Bible verse provider. Respond ONLY with JSON: {"verse":"...","reference":"Book Chapter:Verse (NIV)"}' },
            { role: 'user', content: `Provide an inspiring Bible verse for today (${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}). Return JSON only.` },
          ],
          temperature: 0.9, max_tokens: 250,
        }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        setDailyVerse({ verse: parsed.verse, reference: parsed.reference });
      }
    } catch {
      setDailyVerse({ verse: '"For I know the plans I have for you," declares the Lord, "plans to prosper you and not to harm you, plans to give you hope and a future."', reference: 'Jeremiah 29:11 (NIV)' });
    }
  }, []);

  useEffect(() => { fetchDailyVerse(); }, [fetchDailyVerse]);

  // ---- Helpers ----
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
  };

  const goSlide = (i) => {
    setHeroIndex(i);
    clearInterval(heroTimer.current);
    heroTimer.current = setInterval(() => setHeroIndex(prev => (prev + 1) % HERO_SLIDES.length), 6000);
  };

  const prevSlide = () => goSlide((heroIndex - 1 + HERO_SLIDES.length) % HERO_SLIDES.length);
  const nextSlide = () => goSlide((heroIndex + 1) % HERO_SLIDES.length);

  const scrollToSection = (id) => {
    setMobileNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // ============================================
  // RENDER
  // ============================================
  return (
    <>
      {/* ---- DARK MODE TOGGLE ---- */}
      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode" style={{ zIndex: 1001 }}>
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      {/* ---- NAVBAR ---- */}
      <nav className="hp-navbar">
        <a className="hp-navbar-brand" href="/">
          <img src="/assets/LOGO.png" alt="JSCI Logo" className="hp-navbar-logo" />
          <div className="hp-navbar-title">
            JOYFUL SOUND CHURCH
            <span>INTERNATIONAL</span>
          </div>
        </a>

        <button className="hp-nav-toggle" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
          <i className={`fas ${mobileNavOpen ? 'fa-times' : 'fa-bars'}`}></i>
        </button>

        <div className={`hp-navbar-links ${mobileNavOpen ? 'open' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('about'); }}>About</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('services'); }}>Services</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('activities'); }}>Activities</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('news'); }}>News</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('pastors'); }}>Pastors</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('location'); }}>Location</a>
          <a href="/login" className="hp-btn-login"><i className="fas fa-sign-in-alt"></i> Login</a>
        </div>
      </nav>

      {/* ---- HERO CAROUSEL ---- */}
      <section className="hp-hero">
        {HERO_SLIDES.map((slide, i) => (
          <div key={i} className={`hp-hero-slide ${i === heroIndex ? 'active' : ''}`}>
            <img src={slide.img} alt={slide.title} className="hp-hero-slide-img" />
          </div>
        ))}

        <div className="hp-hero-overlay">
          <img src="/assets/LOGO.png" alt="JSCI Logo" className="hp-hero-logo" />
          <h1 className="hp-hero-heading">JOYFUL SOUND CHURCH</h1>
          <p className="hp-hero-sub">INTERNATIONAL</p>
          <p className="hp-hero-tagline">{HERO_SLIDES[heroIndex].sub}</p>
          <div className="hp-hero-buttons">
            <a href="/signup" className="hp-btn-primary">
              <i className="fas fa-user-plus"></i> Join Our Family
            </a>
            <a href="#about" className="hp-btn-outline" onClick={(e) => { e.preventDefault(); scrollToSection('about'); }}>
              <i className="fas fa-info-circle"></i> Learn More
            </a>
          </div>
        </div>

        <button className="hp-hero-arrow left" onClick={prevSlide}>
          <i className="fas fa-chevron-left"></i>
        </button>
        <button className="hp-hero-arrow right" onClick={nextSlide}>
          <i className="fas fa-chevron-right"></i>
        </button>

        <div className="hp-hero-dots">
          {HERO_SLIDES.map((_, i) => (
            <button key={i} className={`hp-hero-dot ${i === heroIndex ? 'active' : ''}`} onClick={() => goSlide(i)} />
          ))}
        </div>
      </section>

      {/* ---- WELCOME / ABOUT ---- */}
      <section id="about" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>Welcome to Our Church</h2>
          <p>A community of believers passionate about God&apos;s Word, worship, and reaching the nations</p>
        </div>

        <div className="hp-welcome-grid hp-animate">
          <div className="hp-welcome-img-wrapper">
            <img src="/assets/worship-service.jpg" alt="Church worship" />
            <div className="hp-welcome-img-badge">
              <i className="fas fa-church"></i>&nbsp; Est. by God&apos;s Grace
            </div>
          </div>

          <div className="hp-welcome-text">
            <h3>Bringing the Joy of the Lord to Every Nation</h3>
            <p>
              Joyful Sound Church International is a vibrant, Spirit-filled community 
              committed to spreading the gospel of Jesus Christ. Under the leadership 
              of our Senior Pastors Dr. Weldon and Dr. Dorothy Pior, we are a family 
              that worships, grows, and serves together.
            </p>
            <p>
              Whether you&apos;re seeking a church home, looking for fellowship, or simply 
              curious about the Christian faith — you are welcome here. Come experience 
              the love of God in an atmosphere of praise and genuine community.
            </p>

            <div className="hp-welcome-highlights">
              <div className="hp-highlight-item">
                <i className="fas fa-bible"></i>
                <span>Bible-Centered Teaching</span>
              </div>
              <div className="hp-highlight-item">
                <i className="fas fa-music"></i>
                <span>Spirit-Filled Worship</span>
              </div>
              <div className="hp-highlight-item">
                <i className="fas fa-hands-helping"></i>
                <span>Community Outreach</span>
              </div>
              <div className="hp-highlight-item">
                <i className="fas fa-users"></i>
                <span>Youth & Family Ministry</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- SERVICE TIMES ---- */}
      <div className="hp-section-dark">
        <section id="services" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Service Times</h2>
            <p>Join us for worship and fellowship throughout the week</p>
          </div>

          <div className="hp-services-grid hp-animate">
            {SERVICE_TIMES.map((s, i) => (
              <div className="hp-service-card" key={i}>
                <div className="hp-service-icon">
                  <i className={`fas ${s.icon}`}></i>
                </div>
                <h4>{s.name}</h4>
                <div className="hp-service-time">{s.time}</div>
                <div className="hp-service-day">Every {s.day}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- DAILY VERSE ---- */}
      <section className="hp-section hp-animate">
        <div className="hp-section-header">
          <div className="hp-divider"></div>
          <h2>Verse of the Day</h2>
          <p>Be inspired by God&apos;s Word today</p>
        </div>

        <div className="hp-verse-wrapper">
          <div className="hp-verse-icon">
            <i className="fas fa-book-open"></i>
          </div>
          <p className="hp-verse-text">
            {dailyVerse.verse || 'Loading verse of the day...'}
          </p>
          <p className="hp-verse-ref">— {dailyVerse.reference || 'Loading...'}</p>
        </div>
      </section>

      {/* ---- ACTIVITIES ---- */}
      <div className="hp-section-dark">
        <section id="activities" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Church Activities</h2>
            <p>Discover the many ways you can connect, grow, and serve in our community</p>
          </div>

          <div className="hp-activities-grid">
            {ACTIVITIES.map((a, i) => (
              <div className="hp-activity-card hp-animate" key={i} style={{ transitionDelay: `${i * 0.1}s` }}>
                <div className="hp-activity-img-wrapper">
                  <img src={a.photo} alt={a.title} className="hp-activity-img" />
                  <div className="hp-activity-badge">{a.badge}</div>
                </div>
                <div className="hp-activity-body">
                  <h4>{a.title}</h4>
                  <p>{a.desc}</p>
                  <div className="hp-activity-meta">
                    <i className="fas fa-calendar-alt"></i> {a.badge} Activity
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- NEWS & UPDATES ---- */}
      <section id="news" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>News & Upcoming Events</h2>
          <p>Stay updated with what&apos;s happening in our church community</p>
        </div>

        <div className="hp-activities-grid">
          {NEWS_ITEMS.map((n, i) => (
            <div className="hp-activity-card hp-animate" key={i} style={{ transitionDelay: `${i * 0.1}s` }}>
              <div style={{
                height: 160,
                background: `linear-gradient(135deg, var(--primary), #3e2e08)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <i className={`fas ${n.icon}`} style={{ fontSize: '3.5rem', color: 'var(--accent)', opacity: 0.7 }}></i>
              </div>
              <div className="hp-activity-body">
                <h4>{n.title}</h4>
                <p>{n.desc}</p>
                <div className="hp-activity-meta">
                  <i className="fas fa-calendar-check"></i> {n.date}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- PASTORS ---- */}
      <div className="hp-section-dark">
        <section id="pastors" className="hp-section">
          <div className="hp-section-header hp-animate">
            <div className="hp-divider"></div>
            <h2>Our Pastors</h2>
            <p>Meet the dedicated leaders shepherding our church family</p>
          </div>

          <div className="hp-pastors-grid hp-animate">
            {PASTORS.map((p, i) => (
              <div className="hp-pastor-card" key={i}>
                <div className="hp-pastor-photo-wrapper">
                  <img src={p.photo} alt={p.name} />
                </div>
                <h4>{p.name}</h4>
                <div className="hp-pastor-role">{p.title}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ---- VISIT US / MAP ---- */}
      <section id="location" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>Visit Us</h2>
          <p>Come and experience worship with us — here&apos;s where you can find our church</p>
        </div>

        <div className="hp-map-wrapper hp-animate">
          <div className="hp-map-info">
            <div className="hp-map-info-icon">
              <i className="fas fa-map-marker-alt"></i>
            </div>
            <h3>Joyful Sound Church International</h3>
            <p>Join us for Sunday Worship Service every week. Everyone is welcome!</p>
            <div className="hp-map-details">
              <div className="hp-map-detail-item">
                <i className="fas fa-clock"></i>
                <span>Sunday Worship: 9:00 AM</span>
              </div>
              <div className="hp-map-detail-item">
                <i className="fas fa-book-bible"></i>
                <span>Friday Bible Study: 7:00 PM</span>
              </div>
              <div className="hp-map-detail-item">
                <i className="fas fa-phone"></i>
                <span>Contact us for more info</span>
              </div>
            </div>
          </div>
          <div className="hp-map-embed">
            <iframe
              src="https://www.google.com/maps/embed?pb=!4v1772207931266!6m8!1m7!1sdo9Akv3QAW6kJETCDEd_HQ!2m2!1d10.31957253395332!2d123.8994709106599!3f236.24502041751504!4f2.753458141938296!5f0.7820865974627469"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Joyful Sound Church International Location"
            ></iframe>
          </div>
        </div>
      </section>

      {/* ---- CTA BANNER ---- */}
      <section className="hp-cta">
        <h2>Join Our Church Family Today</h2>
        <p>
          We&apos;d love to welcome you! Whether online or in person, there&apos;s a place for you at Joyful Sound Church International.
        </p>
        <a href="/signup" className="hp-btn-primary">
          <i className="fas fa-user-plus"></i> Create an Account
        </a>
      </section>

      {/* ---- FOOTER ---- */}
      <footer className="hp-footer">
        <div className="hp-footer-grid">
          {/* About col */}
          <div className="hp-footer-about">
            <div className="hp-footer-brand">
              <img src="/assets/LOGO.png" alt="JSCI" />
              <h3>
                JOYFUL SOUND CHURCH
                <span>INTERNATIONAL</span>
              </h3>
            </div>
            <p>
              A Spirit-filled community of believers dedicated to spreading the gospel, 
              building disciples, and making a lasting impact for God&apos;s kingdom.
            </p>
            <div className="hp-footer-socials">
              <a href="#" title="Facebook"><i className="fab fa-facebook-f"></i></a>
              <a href="#" title="YouTube"><i className="fab fa-youtube"></i></a>
              <a href="#" title="Instagram"><i className="fab fa-instagram"></i></a>
              <a href="#" title="TikTok"><i className="fab fa-tiktok"></i></a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="hp-footer-col">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="#about"><i className="fas fa-chevron-right"></i> About Us</a></li>
              <li><a href="#services"><i className="fas fa-chevron-right"></i> Service Times</a></li>
              <li><a href="#activities"><i className="fas fa-chevron-right"></i> Activities</a></li>
              <li><a href="#news"><i className="fas fa-chevron-right"></i> News & Events</a></li>
              <li><a href="#pastors"><i className="fas fa-chevron-right"></i> Our Pastors</a></li>
              <li><a href="#location"><i className="fas fa-chevron-right"></i> Visit Us</a></li>
            </ul>
          </div>

          {/* Ministry */}
          <div className="hp-footer-col">
            <h4>Ministries</h4>
            <ul>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Praise & Worship</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Media Ministry</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Dance Ministry</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Ushering Ministry</a></li>
              <li><a href="/login"><i className="fas fa-chevron-right"></i> Youth Ministry</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="hp-footer-col">
            <h4>Get in Touch</h4>
            <ul>
              <li><a href="#"><i className="fas fa-map-marker-alt"></i> Church Location</a></li>
              <li><a href="#"><i className="fas fa-phone"></i> Contact Us</a></li>
              <li><a href="#"><i className="fas fa-envelope"></i> Email Us</a></li>
              <li><a href="/login"><i className="fas fa-sign-in-alt"></i> Member Login</a></li>
              <li><a href="/signup"><i className="fas fa-user-plus"></i> Sign Up</a></li>
            </ul>
          </div>
        </div>

        <div className="hp-footer-bottom">
          <p>&copy; {new Date().getFullYear()} <span>Joyful Sound Church International</span>. All rights reserved.</p>
        </div>
      </footer>

      {/* ---- SCROLL TO TOP ---- */}
      <button
        className={`hp-scroll-top ${scrollTop ? 'visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        title="Back to top"
      >
        <i className="fas fa-arrow-up"></i>
      </button>
    </>
  );
}
