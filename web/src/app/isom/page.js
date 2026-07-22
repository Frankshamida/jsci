'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './isom.css';

export default function IsomPage() {
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subtitle, setSubtitle] = useState('');
  const [aboutHtml, setAboutHtml] = useState('');
  const [bullets, setBullets] = useState([]);
  const [classStartDate, setClassStartDate] = useState('');
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(saved);
    if (saved) {
      document.body.classList.add('dark-mode');
      document.documentElement.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
      document.documentElement.classList.remove('dark-mode');
    }
    fetchIsom();
  }, []);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, 4000);
    return () => clearInterval(t);
  }, [slides.length]);

  const fetchIsom = async () => {
    try {
      const res = await fetch('/api/admin/isom');
      const data = await res.json();
      if (data.success) {
        setSubtitle(data.data.subtitle || '');
        setAboutHtml(data.data.about_html || '');
        setBullets(Array.isArray(data.data.bullets) ? data.data.bullets : []);
        setClassStartDate(data.data.class_start_date || '');
        setSlides(Array.isArray(data.data.slides) ? data.data.slides : []);
      }
    } catch (err) {
      console.error('Failed to load ISOM content:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  const handleBack = () => router.back();

  return (
    <>
      <button className="dark-mode-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <div className="isom-page">
        <div className="isom-container">
          {/* Header */}
          <div className="isom-header">
            <button className="isom-back-btn" onClick={handleBack}>
              <i className="fas fa-arrow-left"></i>
              <span>Back</span>
            </button>
            <div className="isom-brand">
              <img src="/assets/LOGO.png" alt="SanctuaryHub Logo" />
              <div className="isom-brand-text">SanctuaryHub</div>
            </div>
          </div>

          {loading ? (
            <div className="isom-loading">
              <div className="isom-loading-spinner"></div>
              <p>Loading ISOM...</p>
            </div>
          ) : (
            <>
              {/* Hero */}
              <div className="isom-hero">
                <span className="isom-eyebrow"><i className="fas fa-star"></i> Now Enrolling</span>
                <img src="/assets/ISOM_Logo.png" alt="ISOM Logo" className="isom-logo" />
                <h1>International School of Ministries</h1>
                <p className="isom-sub">{subtitle}</p>
              </div>

              {/* Carousel */}
              {slides.length > 0 && (
                <div className="isom-carousel">
                  {slides.map((slide, i) => (
                    <img
                      key={i}
                      src={slide.url}
                      alt={`ISOM ${i + 1}`}
                      className={`isom-slide ${i === slideIndex ? 'active' : ''}`}
                    />
                  ))}
                  {slides.length > 1 && (
                    <>
                      <button className="isom-arrow left" aria-label="Previous"
                        onClick={() => setSlideIndex((slideIndex - 1 + slides.length) % slides.length)}>
                        <i className="fas fa-chevron-left"></i>
                      </button>
                      <button className="isom-arrow right" aria-label="Next"
                        onClick={() => setSlideIndex((slideIndex + 1) % slides.length)}>
                        <i className="fas fa-chevron-right"></i>
                      </button>
                      <div className="isom-dots">
                        {slides.map((_, i) => (
                          <button key={i} className={`isom-dot ${i === slideIndex ? 'active' : ''}`}
                            aria-label={`Slide ${i + 1}`} onClick={() => setSlideIndex(i)} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* About */}
              <div className="isom-about" dangerouslySetInnerHTML={{ __html: aboutHtml }} />

              {/* Highlights */}
              {bullets.length > 0 && (
                <ul className="isom-points">
                  {bullets.map((b, i) => (
                    <li key={i}><i className="fas fa-check-circle"></i> {b}</li>
                  ))}
                </ul>
              )}

              {/* CTA */}
              <div className="isom-cta">
                <div className="isom-date">
                  <i className="fas fa-calendar-day"></i>
                  <div>
                    <span className="isom-date-label">Classes Begin</span>
                    <span className="isom-date-value">{classStartDate}</span>
                  </div>
                </div>
                <a href="/signup" className="isom-btn">
                  <i className="fas fa-graduation-cap"></i> Enroll Now
                </a>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="isom-footer">
            <p>&copy; {new Date().getFullYear()} SanctuaryHub &mdash; All Rights Reserved</p>
          </div>
        </div>
      </div>
    </>
  );
}
