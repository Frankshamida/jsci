'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import './live.css';

const SITE_URL = 'https://jsci.vercel.app';

export default function LivePage() {
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareStream, setShareStream] = useState(null);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Dark mode init
  useEffect(() => {
    const saved = localStorage.getItem('darkModeEnabled');
    if (saved === 'true') {
      setDarkMode(true);
      document.body.classList.add('dark-mode');
      document.documentElement.classList.add('dark-mode');
    }
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  // Extract iframe src
  const extractIframeSrc = (input) => {
    if (!input) return '';
    const match = input.match(/src=["']([^"']+)["']/);
    if (match) return match[1];
    if (input.startsWith('http')) return input;
    return input;
  };

  // Load live streams
  const loadStreams = useCallback(async () => {
    try {
      const res = await fetch('/api/live-streams/public');
      if (res.ok) {
        const data = await res.json();
        setStreams(data);
      }
    } catch (err) {
      console.error('Failed to load live streams:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStreams();
    // Auto-refresh every 30s as fallback
    const interval = setInterval(loadStreams, 30000);

    // Realtime subscription — instant update when admin posts/updates/hides streams
    let channel;
    if (supabase) {
      channel = supabase
        .channel('live-page-streams')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_streams' }, () => {
          loadStreams();
        })
        .subscribe();
    }

    return () => {
      clearInterval(interval);
      if (channel && supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [loadStreams]);

  // Format date
  const formatDateTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  // Share helpers
  const shareUrl = `${SITE_URL}/live`;

  const openShareModal = (stream) => {
    setShareStream(stream);
    setShowShareModal(true);
    setCopied(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const shareToFacebook = () => {
    const text = shareStream ? `🔴 Watch LIVE: ${shareStream.caption || 'Sunday Service'} at SanctuaryHub! 🙏✨` : '🔴 Watch LIVE at SanctuaryHub! 🙏✨';
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(text)}`, '_blank', 'width=600,height=400');
  };

  const shareToMessenger = () => {
    window.open(`https://www.facebook.com/dialog/send?link=${encodeURIComponent(shareUrl)}&app_id=966242223397117&redirect_uri=${encodeURIComponent(shareUrl)}`, '_blank', 'width=600,height=400');
  };

  const shareToWhatsApp = () => {
    const text = shareStream ? `🔴 *LIVE NOW* - ${shareStream.caption || 'Sunday Service'} at SanctuaryHub!\n🙏 Watch here: ${shareUrl}` : `🔴 Watch LIVE at SanctuaryHub!\n🙏 ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareToTelegram = () => {
    const text = shareStream ? `🔴 LIVE NOW - ${shareStream.caption || 'Sunday Service'} at SanctuaryHub!` : '🔴 Watch LIVE at SanctuaryHub!';
    window.open(`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'SanctuaryHub - Live',
          text: shareStream ? `🔴 Watch LIVE: ${shareStream.caption || 'Sunday Service'}` : '🔴 Watch LIVE at SanctuaryHub!',
          url: shareUrl,
        });
      } catch { /* user cancelled */ }
    }
  };

  const toggleFullscreen = () => {
    setFullscreen(!fullscreen);
    if (!fullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  };

  // Active live stream (first one)
  const activeStream = streams.length > 0 ? streams[0] : null;

  return (
    <>
      {/* NAVBAR */}
      <nav className="live-navbar">
        <a className="live-navbar-brand" href="/">
          <img src="/assets/LOGO.png" alt="SanctuaryHub Logo" className="live-navbar-logo" />
          <div className="live-navbar-title">
            SanctuaryHub
          </div>
        </a>
        <div className="live-navbar-right">
          {activeStream && (
            <button className="live-navbar-share-btn" onClick={() => openShareModal(activeStream)}>
              <i className="fas fa-share-alt"></i>
              <span>Share</span>
            </button>
          )}
          <button className="live-navbar-dark-toggle" onClick={toggleDarkMode} title="Toggle Dark Mode">
            <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
          </button>
          <a href="/login" className="live-navbar-login">
            <i className="fas fa-sign-in-alt"></i> Login
          </a>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className={`live-page-main${fullscreen ? ' live-fullscreen-mode' : ''}`}>
        {loading ? (
          <div className="live-loading-state">
            <div className="live-loading-spinner">
              <i className="fas fa-circle-notch fa-spin"></i>
            </div>
            <p>Loading live stream...</p>
          </div>
        ) : activeStream ? (
          <div className="live-content-wrapper">
            {/* Live Header */}
            <div className="live-stream-hero-header">
              <div className="live-hero-badge-row">
                <span className="live-hero-badge-pulse">
                  <i className="fas fa-circle"></i> LIVE NOW
                </span>
                <h1 className="live-hero-title">{activeStream.caption || 'Sunday Service Live'}</h1>
              </div>
              <div className="live-hero-actions">
                <button className="live-hero-share-btn" onClick={() => openShareModal(activeStream)}>
                  <i className="fas fa-share-alt"></i> Share
                </button>
                <button className="live-hero-fullscreen-btn" onClick={toggleFullscreen}>
                  <i className={`fas fa-${fullscreen ? 'compress' : 'expand'}`}></i>
                </button>
              </div>
            </div>

            {/* Video */}
            <div className="live-video-container">
              <div className="live-video-wrapper">
                <iframe
                  src={extractIframeSrc(activeStream.iframe_url)}
                  className="live-video-iframe"
                  allowFullScreen
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                ></iframe>
              </div>
            </div>

            {/* Info Bar */}
            <div className="live-info-bar">
              <div className="live-info-left">
                <div className="live-info-avatar">
                  <img src="/assets/LOGO.png" alt="SanctuaryHub" />
                </div>
                <div className="live-info-details">
                  <h3>SanctuaryHub</h3>
                  <p>Posted by {activeStream.posted_by_name} • {formatDateTime(activeStream.created_at)}</p>
                </div>
              </div>
              <div className="live-info-right">
                <div className="live-info-stat">
                  <i className="fas fa-heart"></i>
                  <span>{activeStream.reactionCount || 0}</span>
                </div>
                <div className="live-info-stat">
                  <i className="fas fa-comment"></i>
                  <span>{activeStream.commentCount || 0}</span>
                </div>
                <button className="live-info-share-btn" onClick={() => openShareModal(activeStream)}>
                  <i className="fas fa-share"></i> Share Live
                </button>
              </div>
            </div>

            {/* CTA */}
            <div className="live-cta-section">
              <div className="live-cta-card">
                <div className="live-cta-icon">🙏</div>
                <h3>Join the Conversation!</h3>
                <p>Login or create an account to participate in live chat, react to the stream, and connect with our church family.</p>
                <div className="live-cta-btns">
                  <a href="/login" className="live-cta-login"><i className="fas fa-sign-in-alt"></i> Login</a>
                  <a href="/signup" className="live-cta-signup"><i className="fas fa-user-plus"></i> Sign Up Free</a>
                </div>
              </div>
              <div className="live-cta-share-card">
                <h4><i className="fas fa-share-alt"></i> Spread the Word!</h4>
                <p>Invite friends and family to watch this live stream together.</p>
                <div className="live-cta-share-buttons">
                  <button className="live-share-btn-facebook" onClick={shareToFacebook}>
                    <i className="fab fa-facebook-f"></i> Facebook
                  </button>
                  <button className="live-share-btn-messenger" onClick={shareToMessenger}>
                    <i className="fab fa-facebook-messenger"></i> Messenger
                  </button>
                  <button className="live-share-btn-whatsapp" onClick={shareToWhatsApp}>
                    <i className="fab fa-whatsapp"></i> WhatsApp
                  </button>
                  <button className="live-share-btn-copy" onClick={copyLink}>
                    <i className={`fas ${copied ? 'fa-check' : 'fa-link'}`}></i> {copied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              </div>
            </div>

            {/* More Streams */}
            {streams.length > 1 && (
              <div className="live-more-streams">
                <h3><i className="fas fa-broadcast-tower"></i> More Live Streams</h3>
                <div className="live-more-grid">
                  {streams.slice(1).map((s) => (
                    <div key={s.id} className="live-more-card">
                      <div className="live-more-video">
                        <iframe
                          src={extractIframeSrc(s.iframe_url)}
                          allowFullScreen
                          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                        ></iframe>
                      </div>
                      <div className="live-more-info">
                        <span className="live-more-badge"><i className="fas fa-circle"></i> LIVE</span>
                        <h4>{s.caption || 'Sunday Service Live'}</h4>
                        <p>{s.posted_by_name} • {formatDateTime(s.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* No Live Stream */
          <div className="live-empty-state">
            <div className="live-empty-icon">
              <i className="fas fa-broadcast-tower"></i>
            </div>
            <h2>No Live Stream Right Now</h2>
            <p>There are no active live streams at the moment. Check back during our service times!</p>
            <div className="live-empty-schedule">
              <h4><i className="fas fa-clock"></i> Service Times</h4>
              <div className="live-schedule-items">
                <div className="live-schedule-item">
                  <span className="live-schedule-day">Sunday</span>
                  <span className="live-schedule-time">9:00 AM - Worship Service</span>
                </div>
                <div className="live-schedule-item">
                  <span className="live-schedule-day">Wednesday</span>
                  <span className="live-schedule-time">7:00 PM - Bible Study</span>
                </div>
                <div className="live-schedule-item">
                  <span className="live-schedule-day">Friday</span>
                  <span className="live-schedule-time">7:00 PM - Prayer Meeting</span>
                </div>
              </div>
            </div>
            <div className="live-empty-cta">
              <a href="/" className="live-back-home"><i className="fas fa-home"></i> Back to Home</a>
              <a href="/signup" className="live-join-btn"><i className="fas fa-user-plus"></i> Join Our Community</a>
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="live-footer">
        <div className="live-footer-inner">
          <div className="live-footer-brand">
            <img src="/assets/LOGO.png" alt="SanctuaryHub" />
            <div>
              <strong>SanctuaryHub</strong>
              <span>A Spirit-filled community of believers</span>
            </div>
          </div>
          <div className="live-footer-links">
            <a href="/"><i className="fas fa-home"></i> Home</a>
            <a href="/login"><i className="fas fa-sign-in-alt"></i> Login</a>
            <a href="/signup"><i className="fas fa-user-plus"></i> Sign Up</a>
            <a href="/terms"><i className="fas fa-file-contract"></i> Terms</a>
            <a href="/privacy-policy"><i className="fas fa-shield-alt"></i> Privacy</a>
          </div>
          <p className="live-footer-copy">&copy; {new Date().getFullYear()} SanctuaryHub. All rights reserved.</p>
        </div>
      </footer>

      {/* SHARE MODAL */}
      {showShareModal && (
        <div className="live-share-modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="live-share-modal" onClick={(e) => e.stopPropagation()}>
            <button className="live-share-modal-close" onClick={() => setShowShareModal(false)}>
              <i className="fas fa-times"></i>
            </button>
            <div className="live-share-modal-header">
              <div className="live-share-modal-icon">🔴</div>
              <h3>Share Live Stream</h3>
              <p>Invite others to watch {shareStream?.caption || 'our live service'}</p>
            </div>
            <div className="live-share-modal-body">
              {/* Preview Card */}
              <div className="live-share-preview">
                <img src="/assets/LOGO.png" alt="SanctuaryHub" className="live-share-preview-logo" />
                <div className="live-share-preview-info">
                  <span className="live-share-preview-badge"><i className="fas fa-circle"></i> LIVE</span>
                  <strong>{shareStream?.caption || 'Sunday Service Live'}</strong>
                  <span>jsci.vercel.app/live</span>
                </div>
              </div>

              {/* Share Buttons */}
              <div className="live-share-buttons-grid">
                <button className="live-share-option facebook" onClick={shareToFacebook}>
                  <i className="fab fa-facebook-f"></i>
                  <span>Facebook</span>
                </button>
                <button className="live-share-option messenger" onClick={shareToMessenger}>
                  <i className="fab fa-facebook-messenger"></i>
                  <span>Messenger</span>
                </button>
                <button className="live-share-option whatsapp" onClick={shareToWhatsApp}>
                  <i className="fab fa-whatsapp"></i>
                  <span>WhatsApp</span>
                </button>
                <button className="live-share-option telegram" onClick={shareToTelegram}>
                  <i className="fab fa-telegram-plane"></i>
                  <span>Telegram</span>
                </button>
                {typeof navigator !== 'undefined' && navigator.share && (
                  <button className="live-share-option native" onClick={shareNative}>
                    <i className="fas fa-share-alt"></i>
                    <span>More</span>
                  </button>
                )}
              </div>

              {/* Copy Link */}
              <div className="live-share-copy-row">
                <div className="live-share-copy-input">
                  <i className="fas fa-link"></i>
                  <input type="text" readOnly value={shareUrl} />
                </div>
                <button className={`live-share-copy-btn${copied ? ' copied' : ''}`} onClick={copyLink}>
                  <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Close Button */}
      {fullscreen && (
        <button className="live-fullscreen-close" onClick={toggleFullscreen}>
          <i className="fas fa-times"></i> Exit Fullscreen
        </button>
      )}
    </>
  );
}
