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

const ISOM_SLIDES = [
  '/assets/isom-training.jpg',
  '/assets/christian-leadership-conference.jpg',
  '/assets/friday-bible-study.jpg',
  '/assets/worship-service.jpg',
  '/assets/community-outreach.jpg',
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
  const [dailyVerse, setDailyVerse] = useState({ verse: '', reference: '' });
  const [hasActiveLive, setHasActiveLive] = useState(false);
  const heroTimer = useRef(null);
  const [isomIndex, setIsomIndex] = useState(0);
  const [newsEvents, setNewsEvents] = useState([]);

  // ---- Chatbot (Joy AI Assistant) ----
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: "Hello, I'm **Joy**, your SanctuaryHub assistant. 😊\n\nI'd be glad to help you with:\n- **Service times** and weekly gatherings\n- **ISOM** enrollment and details\n- Upcoming **events** and announcements\n- Getting connected or creating an account\n\nHow may I assist you today?" },
  ]);
  const chatBodyRef = useRef(null);

  // ---- Check logged in & catch OAuth hash redirect ----
  useEffect(() => {
    // Safety net: if Google OAuth redirects to root with tokens in hash, redirect to callback page
    if (typeof window !== 'undefined' && window.location.hash && window.location.hash.includes('access_token')) {
      const hashParams = window.location.hash.substring(1);
      router.replace(`/auth/callback?mode=login#${hashParams}`);
      return;
    }

    const userData = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}');
    if (userData && userData.firstname && userData.email) {
      router.replace('/dashboard');
      return;
    }
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(saved);
    if (saved) { document.body.classList.add('dark-mode'); document.documentElement.classList.add('dark-mode'); }
  }, [router]);

  // ---- Hero auto-rotate ----
  useEffect(() => {
    heroTimer.current = setInterval(() => {
      setHeroIndex(prev => (prev + 1) % HERO_SLIDES.length);
    }, 6000);
    return () => clearInterval(heroTimer.current);
  }, []);

  // ---- ISOM carousel auto-rotate ----
  useEffect(() => {
    const t = setInterval(() => {
      setIsomIndex(prev => (prev + 1) % ISOM_SLIDES.length);
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // ---- Load events for the News section (upcoming first, then most recent) ----
  useEffect(() => {
    const loadNews = async () => {
      try {
        const res = await fetch('/api/events?limit=20');
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            const now = Date.now();
            const sorted = [...json.data].sort((a, b) => {
              const da = new Date(a.event_date).getTime();
              const db = new Date(b.event_date).getTime();
              const aUpcoming = da >= now;
              const bUpcoming = db >= now;
              // Upcoming events first (soonest first), then past events (most recent first)
              if (aUpcoming && bUpcoming) return da - db;
              if (aUpcoming) return -1;
              if (bUpcoming) return 1;
              return db - da;
            });
            setNewsEvents(sorted.slice(0, 8));
          }
        }
      } catch { /* fall back to defaults */ }
    };
    loadNews();
  }, []);

  // ---- Check for active live streams ----
  useEffect(() => {
    const checkLiveStreams = async () => {
      try {
        const res = await fetch('/api/live-streams/public');
        if (res.ok) {
          const data = await res.json();
          setHasActiveLive(Array.isArray(data) && data.length > 0);
        }
      } catch { /* silent */ }
    };
    checkLiveStreams();
    // Re-check every 30s
    const liveCheckInterval = setInterval(checkLiveStreams, 30000);
    return () => clearInterval(liveCheckInterval);
  }, []);

  // ---- Scroll listener ----
  useEffect(() => {
    const handleScroll = () => {
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

  // ---- Daily verse (cached 24h in localStorage) ----
  const fetchDailyVerse = useCallback(async () => {
    const FALLBACK = { verse: '"For I know the plans I have for you," declares the Lord, "plans to prosper you and not to harm you, plans to give you hope and a future."', reference: 'Jeremiah 29:11 (NIV)' };
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 1) Serve a cached verse if it's less than 24h old
    try {
      const cached = JSON.parse(localStorage.getItem('dailyVerse') || 'null');
      if (cached && cached.verse && cached.savedAt && (Date.now() - cached.savedAt) < ONE_DAY) {
        setDailyVerse({ verse: cached.verse, reference: cached.reference });
        return;
      }
    } catch { /* ignore corrupt cache */ }

    if (!GROQ_API_KEY) {
      setDailyVerse(FALLBACK);
      return;
    }

    // 2) Otherwise fetch a fresh verse from Groq and cache it for the day
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a Bible verse provider. Respond ONLY with valid JSON in the exact form {"verse":"...","reference":"Book Chapter:Verse (NIV)"} and nothing else.' },
            { role: 'user', content: `Provide a single inspiring, uplifting Bible verse for today (${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}). Vary the book and choose an encouraging verse. Return JSON only.` },
          ],
          temperature: 1.0, max_tokens: 250,
        }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.verse && parsed.reference) {
          setDailyVerse({ verse: parsed.verse, reference: parsed.reference });
          localStorage.setItem('dailyVerse', JSON.stringify({ verse: parsed.verse, reference: parsed.reference, savedAt: Date.now() }));
          return;
        }
      }
      setDailyVerse(FALLBACK);
    } catch {
      setDailyVerse(FALLBACK);
    }
  }, []);

  useEffect(() => { fetchDailyVerse(); }, [fetchDailyVerse]);

  // ---- Chatbot: auto-scroll to newest message ----
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading, chatOpen]);

  const CHAT_SYSTEM_PROMPT = `You are "Joy", the professional AI assistant for SanctuaryHub — the online ministry portal of Jesus Sanctuary Christian International (JSCI).

TONE & STYLE:
- Write in a warm but professional and polished tone, like a helpful ministry representative.
- Be concise and well-organized. Prefer short paragraphs (1-2 sentences) separated by a blank line.
- When listing details (times, steps, options), use bullet points starting with "- ".
- Emphasize the most important words or key terms using **bold** markdown (e.g. **Sunday 9:00 AM**, **ISOM**, **August 2026**). Bold sparingly and purposefully — only the key terms, not whole sentences.
- Use emojis very sparingly — at most ONE per reply, and only when it genuinely adds warmth. Many replies should have none.
- Do NOT use markdown headings (#) or tables. Only **bold**, plain paragraphs, and "- " bullets.

KEY FACTS:
- Worship Service: **Sunday 9:00 AM**. Bible Study: **Friday 7:00 PM**. Youth Fellowship: **Saturday 2:00 PM**.
- Senior Pastors: **Dr. Weldon Pior** and **Dr. Dorothy Pior**.
- ISOM (International School of Ministries) is a ministry-training program. Classes begin **August 2026**. People enroll by signing up / clicking "Enroll Now".
- Users can sign up or log in from the navbar buttons, and watch live streams when a service is live.

If you don't know something specific, professionally encourage the user to contact the church office or visit in person. Keep answers focused (usually 2-4 short paragraphs or a short list). Never invent doctrine; refer spiritual counsel to a pastor.`;

  // Render a single line, converting **bold** markdown into <strong> spans
  const renderInline = (text, keyPrefix) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${keyPrefix}-${i}`} className="hp-chat-em">{part.slice(2, -2)}</strong>;
      }
      return <span key={`${keyPrefix}-${i}`}>{part}</span>;
    });
  };

  // Convert Joy's reply (bold, paragraphs, "- " bullets) into formatted JSX
  const renderRichText = (content) => {
    const lines = content.split('\n');
    const blocks = [];
    let bullets = [];
    const flushBullets = (key) => {
      if (bullets.length) {
        blocks.push(
          <ul className="hp-chat-list" key={`ul-${key}`}>
            {bullets.map((b, i) => <li key={i}>{renderInline(b, `li-${key}-${i}`)}</li>)}
          </ul>
        );
        bullets = [];
      }
    };
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (/^[-•]\s+/.test(line)) {
        bullets.push(line.replace(/^[-•]\s+/, ''));
      } else if (line === '') {
        flushBullets(idx);
      } else {
        flushBullets(idx);
        blocks.push(<p className="hp-chat-p" key={`p-${idx}`}>{renderInline(line, `p-${idx}`)}</p>);
      }
    });
    flushBullets('end');
    return blocks;
  };

  // Detect sign-up / sign-in intent in a reply and attach clickable buttons
  const buildChatActions = (reply) => {
    const t = reply.toLowerCase();
    const actions = [];
    if (/(sign\s?up|signup|register|enroll|create an account|join)/.test(t)) {
      actions.push({ label: 'Sign Up', href: '/signup', icon: 'fa-user-plus' });
    }
    if (/(sign\s?in|signin|log\s?in|login|log in to)/.test(t)) {
      actions.push({ label: 'Sign In', href: '/login', icon: 'fa-sign-in-alt' });
    }
    return actions;
  };

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const newMessages = [...chatMessages, { role: 'user', content: text }];
    setChatMessages(newMessages);
    setChatInput('');
    setChatLoading(true);

    if (!GROQ_API_KEY) {
      const fallback = "I'm not fully connected right now, but here's what I can share: our Worship Service is Sunday 9 AM, and ISOM classes begin August 2026. You can sign up or sign in anytime below. 🙏";
      setChatMessages([...newMessages, { role: 'assistant', content: fallback, actions: buildChatActions(fallback + ' sign up sign in') }]);
      setChatLoading(false);
      return;
    }

    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...newMessages.slice(-8).map(m => ({ role: m.role, content: m.content })),
          ],
          temperature: 0.7, max_tokens: 400,
        }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, I didn't quite catch that. Could you rephrase? 😊";
      setChatMessages([...newMessages, { role: 'assistant', content: reply, actions: buildChatActions(reply) }]);
    } catch {
      setChatMessages([...newMessages, { role: 'assistant', content: "I'm having trouble connecting right now. Please try again in a moment, or contact the church office. 🙏" }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ---- Helpers ----
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
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
      {/* ---- NAVBAR ---- */}
      <nav className="hp-navbar">
        <a className="hp-navbar-brand" href="/">
          <img src="/assets/LOGO.png" alt="SanctuaryHub Logo" className="hp-navbar-logo" fetchPriority="high" decoding="async" />
          <div className="hp-navbar-title">
            SanctuaryHub
          </div>
        </a>

        <div className={`hp-navbar-links ${mobileNavOpen ? 'open' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('about'); }}>About</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('services'); }}>Services</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('activities'); }}>Activities</a>
          <a href="#" className="hp-nav-isom" onClick={(e) => { e.preventDefault(); scrollToSection('isom'); }}><i className="fas fa-graduation-cap"></i> ISOM</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('news'); }}>News</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('pastors'); }}>Pastors</a>
          <a href="#" onClick={(e) => { e.preventDefault(); scrollToSection('location'); }}>Location</a>
          {hasActiveLive && <a href="/live" className="hp-btn-live"><i className="fas fa-broadcast-tower"></i> Watch Live</a>}
          <a href="/login" className="hp-btn-login"><i className="fas fa-sign-in-alt"></i> Login</a>
          <a href="/signup" className="hp-btn-signup"><i className="fas fa-user-plus"></i> Sign Up</a>
        </div>

        <div className="hp-navbar-actions">
          <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
            <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
          </button>
          <button className="hp-nav-toggle" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
            <i className={`fas ${mobileNavOpen ? 'fa-times' : 'fa-bars'}`}></i>
          </button>
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
          <img src="/assets/LOGO.png" alt="SanctuaryHub Logo" className="hp-hero-logo" />
          <h1 className="hp-hero-heading">SanctuaryHub</h1>
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
            <img src="/assets/worship-service.jpg" alt="Church worship" loading="lazy" decoding="async" />
            <div className="hp-welcome-img-badge">
              <i className="fas fa-church"></i>&nbsp; Est. by God&apos;s Grace
            </div>
          </div>

          <div className="hp-welcome-text">
            <h3>Bringing the Joy of the Lord to Every Nation</h3>
            <p>
              SanctuaryHub is a vibrant, Spirit-filled community 
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
                  <img src={a.photo} alt={a.title} className="hp-activity-img" loading="lazy" decoding="async" />
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

      {/* ---- ISOM ---- */}
      <section id="isom" className="hp-isom">
        <div className="hp-isom-bg"></div>
        <div className="hp-isom-overlay"></div>

        <div className="hp-isom-inner">
          <div className="hp-isom-header hp-animate">
            <span className="hp-isom-eyebrow"><i className="fas fa-star"></i> Now Enrolling</span>
            <img src="/assets/ISOM_Logo.png" alt="ISOM Logo" className="hp-isom-logo" loading="lazy" decoding="async" />
            <h2>International School of Ministries</h2>
            <p className="hp-isom-sub">
              Be equipped, empowered, and sent — a Spirit-filled ministry training program
              raising up the next generation of kingdom leaders.
            </p>
          </div>

          <div className="hp-isom-body hp-animate">
            <div className="hp-isom-carousel">
              {ISOM_SLIDES.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`ISOM ${i + 1}`}
                  loading="lazy"
                  decoding="async"
                  className={`hp-isom-slide ${i === isomIndex ? 'active' : ''}`}
                />
              ))}
              <button className="hp-isom-arrow left" aria-label="Previous"
                onClick={() => setIsomIndex((isomIndex - 1 + ISOM_SLIDES.length) % ISOM_SLIDES.length)}>
                <i className="fas fa-chevron-left"></i>
              </button>
              <button className="hp-isom-arrow right" aria-label="Next"
                onClick={() => setIsomIndex((isomIndex + 1) % ISOM_SLIDES.length)}>
                <i className="fas fa-chevron-right"></i>
              </button>
              <div className="hp-isom-dots">
                {ISOM_SLIDES.map((_, i) => (
                  <button key={i} className={`hp-isom-dot ${i === isomIndex ? 'active' : ''}`}
                    aria-label={`Slide ${i + 1}`} onClick={() => setIsomIndex(i)} />
                ))}
              </div>
            </div>

            <div className="hp-isom-side">
              <ul className="hp-isom-points">
                <li><i className="fas fa-book-bible"></i> Solid biblical foundation & sound doctrine</li>
                <li><i className="fas fa-hands-praying"></i> Spirit-empowered prayer & worship</li>
                <li><i className="fas fa-people-group"></i> Hands-on leadership & ministry training</li>
                <li><i className="fas fa-globe"></i> A heart to reach the nations for Christ</li>
              </ul>

              <div className="hp-isom-cta">
                <div className="hp-isom-date">
                  <i className="fas fa-calendar-day"></i>
                  <div>
                    <span className="hp-isom-date-label">Classes Begin</span>
                    <span className="hp-isom-date-value">August 2026</span>
                  </div>
                </div>
                <a href="/signup" className="hp-isom-btn">
                  <i className="fas fa-graduation-cap"></i> Enroll Now
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- NEWS & UPDATES ---- */}
      <section id="news" className="hp-section">
        <div className="hp-section-header hp-animate">
          <div className="hp-divider"></div>
          <h2>News & Upcoming Events</h2>
          <p>Stay updated with what&apos;s happening in our church community</p>
        </div>

        <div className="hp-activities-grid">
          {newsEvents.length > 0 ? (
            newsEvents.map((evt, i) => {
              const start = evt.event_date ? new Date(evt.event_date) : null;
              const dateLabel = start
                ? start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : '';
              return (
                <div className="hp-activity-card hp-animate" key={evt.id || i} style={{ transitionDelay: `${i * 0.1}s` }}>
                  {evt.image_url ? (
                    <div className="hp-activity-img-wrapper">
                      <img src={evt.image_url} alt={evt.title} className="hp-activity-img" loading="lazy" decoding="async" />
                    </div>
                  ) : (
                    <div style={{ height: 160, background: 'linear-gradient(135deg, var(--primary), #3e2e08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="fas fa-calendar-day" style={{ fontSize: '3.5rem', color: 'var(--accent)', opacity: 0.7 }}></i>
                    </div>
                  )}
                  <div className="hp-activity-body">
                    <h4>{evt.title}</h4>
                    {evt.description && <p>{evt.description}</p>}
                    {evt.location && (
                      <div className="hp-activity-meta"><i className="fas fa-location-dot"></i> {evt.location}</div>
                    )}
                    {dateLabel && (
                      <div className="hp-activity-meta"><i className="fas fa-calendar-check"></i> {dateLabel}</div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            NEWS_ITEMS.map((n, i) => (
              <div className="hp-activity-card hp-animate" key={i} style={{ transitionDelay: `${i * 0.1}s` }}>
                <div style={{ height: 160, background: 'linear-gradient(135deg, var(--primary), #3e2e08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            ))
          )}
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
                  <img src={p.photo} alt={p.name} loading="lazy" decoding="async" />
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
            <h3>SanctuaryHub</h3>
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
              allow="accelerometer; gyroscope; magnetometer; fullscreen"
              title="SanctuaryHub Location"
            ></iframe>
          </div>
        </div>
      </section>

      {/* ---- CTA BANNER ---- */}
      <section className="hp-cta">
        <h2>Join Our Church Family Today</h2>
        <p>
          We&apos;d love to welcome you! Whether online or in person, there&apos;s a place for you at SanctuaryHub.
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
              <img src="/assets/LOGO.png" alt="SanctuaryHub" loading="lazy" decoding="async" />
              <h3>
                SanctuaryHub
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
              {hasActiveLive && <li><a href="/live"><i className="fas fa-broadcast-tower"></i> Watch Live</a></li>}
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
          <p>&copy; {new Date().getFullYear()} <span>SanctuaryHub</span>. All rights reserved.</p>
        </div>
      </footer>

      {/* ---- JOY AI CHATBOT ---- */}
      <div className={`hp-chat ${chatOpen ? 'open' : ''}`}>
        <div className="hp-chat-window" role="dialog" aria-label="Joy AI Assistant">
          <div className="hp-chat-header">
            <div className="hp-chat-header-info">
              <img src="/assets/Joy_Mascot.webp" alt="Joy" className="hp-chat-avatar" loading="lazy" decoding="async" />
              <div>
                <span className="hp-chat-name">Joy</span>
                <span className="hp-chat-status"><i className="fas fa-circle"></i> AI Assistant</span>
              </div>
            </div>
            <button className="hp-chat-close" onClick={() => setChatOpen(false)} aria-label="Close chat">
              <i className="fas fa-times"></i>
            </button>
          </div>

          <div className="hp-chat-body" ref={chatBodyRef}>
            {chatMessages.map((m, i) => (
              <div key={i} className={`hp-chat-msg ${m.role}`}>
                <div className="hp-chat-bubble">
                  {m.role === 'assistant' ? renderRichText(m.content) : m.content}
                </div>
                {m.actions && m.actions.length > 0 && (
                  <div className="hp-chat-actions">
                    {m.actions.map((a, j) => (
                      <a key={j} href={a.href} className="hp-chat-action-btn">
                        <i className={`fas ${a.icon}`}></i> {a.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div className="hp-chat-msg assistant">
                <div className="hp-chat-bubble hp-chat-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
          </div>

          <form
            className="hp-chat-input"
            onSubmit={(e) => { e.preventDefault(); sendChatMessage(); }}
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask Joy anything..."
              aria-label="Message"
            />
            <button type="submit" disabled={!chatInput.trim() || chatLoading} aria-label="Send">
              <i className="fas fa-paper-plane"></i>
            </button>
          </form>
        </div>

        <button
          className="hp-chat-launcher"
          onClick={() => setChatOpen(o => !o)}
          title="Chat with Joy"
          aria-label="Chat with Joy, our AI Assistant"
        >
          <img src="/assets/Joy_Mascot.webp" alt="Joy AI Assistant" draggable="false" loading="lazy" decoding="async" fetchPriority="low" />
        </button>
      </div>
    </>
  );
}
