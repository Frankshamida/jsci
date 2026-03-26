'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import '@/app/dashboard/dashboard.css';

function formatDateTime(value) {
  try {
    const d = new Date(value);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

export default function ImageViewerPage({ params }) {
  const { postId } = params || {};
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialIdx = useMemo(() => {
    const idx = parseInt(searchParams.get('idx') || '0', 10);
    return Number.isNaN(idx) ? 0 : Math.max(idx, 0);
  }, [searchParams]);

  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(initialIdx);
  const [imgLoaded, setImgLoaded] = useState(false);

  const fetchPost = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/community?postId=${postId}`);
      if (!res.ok) throw new Error('Failed to load image');
      const data = await res.json();
      if (!data.success || !Array.isArray(data.data) || data.data.length === 0) throw new Error('Image not found');
      setPost(data.data[0]);
    } catch (e) {
      setError(e.message || 'Failed to load image');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => { fetchPost(); }, [fetchPost]);
  useEffect(() => { setIndex(initialIdx); }, [initialIdx]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') router.back();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const goPrev = useCallback(() => {
    if (!post || !post.images) return;
    setIndex((i) => Math.max(0, i - 1));
    const nextIdx = Math.max(0, index - 1);
    router.replace(`/community/image/${postId}?idx=${nextIdx}`);
  }, [index, post, postId, router]);

  const goNext = useCallback(() => {
    if (!post || !post.images) return;
    const max = post.images.length - 1;
    const nextIdx = Math.min(max, index + 1);
    setIndex(nextIdx);
    router.replace(`/community/image/${postId}?idx=${nextIdx}`);
  }, [index, post, postId, router]);

  const currentImage = post?.images?.[index];

  return (
    <div className="viewer-page" style={{ minHeight: '100vh', background: '#05060a', color: '#f5f7ff', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <button
          onClick={() => router.back()}
          style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 18 }}>←</span> <span>Back</span>
        </button>
        <div style={{ fontSize: 14, opacity: 0.8 }}>Photo Viewer</div>
        <div style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.7 }}>Use ← → keys to navigate</div>
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', gap: 12, padding: '12px', minHeight: 0 }}>
        <div style={{ position: 'relative', background: 'rgba(255,255,255,0.02)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          {loading && <div style={{ color: '#9aa0b5' }}>Loading image...</div>}
          {error && <div style={{ color: '#ef5350' }}>{error}</div>}
          {!loading && !error && currentImage && (
            <>
              {!imgLoaded && (
                <div className="community-img-loader viewer-loader" style={{ position: 'absolute' }}>
                  <img src="/assets/LOGO.png" alt="" className="community-img-loader-logo" />
                </div>
              )}
              <img
                src={currentImage.delivery_url || `/api/recordings/stream?fileId=${currentImage.google_drive_file_id}`}
                alt=""
                className={`community-photo-viewer-img${imgLoaded ? ' loaded' : ''}`}
                style={{ maxWidth: '95vw', maxHeight: '90vh', objectFit: 'contain' }}
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgLoaded(true)}
              />
              {index > 0 && (
                <button className="community-photo-viewer-nav prev" onClick={goPrev}><i className="fas fa-chevron-left"></i></button>
              )}
              {post.images && index < post.images.length - 1 && (
                <button className="community-photo-viewer-nav next" onClick={goNext}><i className="fas fa-chevron-right"></i></button>
              )}
            </>
          )}
        </div>

        <aside style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: 14, overflowY: 'auto' }}>
          {loading && <div style={{ color: '#9aa0b5' }}>Loading details...</div>}
          {error && <div style={{ color: '#ef5350' }}>{error}</div>}
          {!loading && !error && post && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: '#1c1f2b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cdd4e0', fontWeight: 700 }}>
                  {post.author_picture ? (
                    <img src={post.author_picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span>{post.author_name?.split(' ').map(n => n[0]).join('').slice(0,2) || '?'}</span>
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{post.author_name || 'Unknown'}</div>
                  <div style={{ fontSize: 12, color: '#9aa0b5' }}>{formatDateTime(post.created_at)}</div>
                </div>
              </div>

              {post.content && (
                <div style={{ margin: '8px 0 12px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {post.content}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, color: '#cfd5e2' }}>
                <span>❤️ {post.reactionCounts?.heart || 0}</span>
                <span>🔥 {post.reactionCounts?.fire || 0}</span>
                <span>🙌 {post.reactionCounts?.praise || 0}</span>
                <span style={{ marginLeft: 'auto', color: '#9aa0b5' }}>Comments: {post.commentCount || 0}</span>
              </div>

              {post.images && post.images.length > 1 && (
                <div className="community-photo-viewer-thumbs">
                  {post.images.map((img, i) => (
                    <div key={img.id} className={`community-photo-viewer-thumb${i === index ? ' active' : ''}`} onClick={() => router.replace(`/community/image/${postId}?idx=${i}`)}>
                      <img src={img.delivery_url || `/api/recordings/stream?fileId=${img.google_drive_file_id}`} alt="" />
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Link href="#" style={{ color: '#9aa0b5', fontSize: 13 }}>View comments</Link>
                <Link href="#" style={{ color: '#9aa0b5', fontSize: 13 }}>Open post</Link>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
