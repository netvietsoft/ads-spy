'use client';
import { useState } from 'react';
import { FbAd, assetProxy } from '../api';

export function FbModal({ ad, onClose }: { ad: FbAd; onClose: () => void }) {
  const media = [
    ...ad.images.map((u) => ({ type: 'image' as const, url: u })),
    ...ad.videos.map((u) => ({ type: 'video' as const, url: u })),
  ];
  const [idx, setIdx] = useState(0);
  const cur = media[idx];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{ad.pageName || 'Không rõ Page'}</div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              {(ad.platforms || []).join(' · ')} · ID {ad.adArchiveId}
              {ad.startedRunning ? ` · ${ad.startedRunning}` : ''}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>
            Đóng ✕
          </button>
        </div>

        {ad.bodyText && (
          <div className="fbbody" style={{ maxHeight: 'none', marginTop: 12 }}>
            {ad.bodyText}
          </div>
        )}

        {cur && (
          <div className="fbviewer">
            {cur.type === 'image' ? (
              <img src={assetProxy(cur.url)} alt="asset" />
            ) : (
              <video src={assetProxy(cur.url)} controls preload="metadata" />
            )}
            <div className="fbviewer-bar">
              <button
                className="ghost"
                onClick={() => setIdx((i) => (i - 1 + media.length) % media.length)}
                disabled={media.length < 2}
              >
                ‹
              </button>
              <span>
                {idx + 1}/{media.length} · {cur.type}
              </span>
              <button
                className="ghost"
                onClick={() => setIdx((i) => (i + 1) % media.length)}
                disabled={media.length < 2}
              >
                ›
              </button>
              <a className="dl" href={assetProxy(cur.url, true)} target="_blank" rel="noreferrer">
                ↓ Tải
              </a>
            </div>
          </div>
        )}

        {/* thumbnails */}
        {media.length > 1 && (
          <div className="fbthumbs">
            {media.map((m, i) => (
              <button key={i} className={`fbthumb ${i === idx ? 'active' : ''}`} onClick={() => setIdx(i)}>
                {m.type === 'image' ? (
                  <img src={assetProxy(m.url)} alt="" loading="lazy" />
                ) : (
                  <span className="vidtag">▶</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="fbfoot" style={{ marginTop: 14 }}>
          {ad.linkUrl && (
            <a className="dl" href={ad.linkUrl} target="_blank" rel="noreferrer">
              ↗ {ad.ctaText || 'Link đích'}
            </a>
          )}
          {ad.snapshotUrl && (
            <a className="dl" href={ad.snapshotUrl} target="_blank" rel="noreferrer">
              Xem trên Meta
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
