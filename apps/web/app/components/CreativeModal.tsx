'use client';
import { useEffect, useState } from 'react';
import { CreativeBrief, CreativeDetail, assetProxy, embedSrc, getCreative } from '../api';

function fmtDate(unix?: number) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleDateString('vi-VN');
}

export function CreativeModal({ creative, onClose }: { creative: CreativeBrief; onClose: () => void }) {
  const [detail, setDetail] = useState<CreativeDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getCreative(creative.advertiserId, creative.creativeId)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [creative]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{creative.advertiserName}</div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              {creative.advertiserId} · {creative.creativeId}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>
            Đóng ✕
          </button>
        </div>

        {err && <div className="error">{err}</div>}
        {!detail && !err && (
          <p className="hint">
            <span className="spinner" /> Đang tải chi tiết…
          </p>
        )}

        {detail && (
          <>
            <div className="hint" style={{ marginTop: 12 }}>
              Lần cuối hiển thị: {fmtDate(detail.lastShown)} · Số vùng hiển thị: {detail.regions.length}
            </div>
            <div className="variants">
              {detail.variants.map((v, i) => (
                <div className={`v ${v.assetType === 'embed' ? 'embed' : ''}`} key={i}>
                  {v.assetType === 'image' && v.assetUrl ? (
                    <img src={assetProxy(v.assetUrl)} alt={`variant ${i}`} />
                  ) : v.assetType === 'embed' && v.assetUrl ? (
                    <iframe
                      className="embed-frame"
                      src={embedSrc(v.assetUrl)}
                      title={`quảng cáo ${i}`}
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  ) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                      {v.assetType}
                    </div>
                  )}
                  <div className="cap">
                    <span className={`badge ${v.assetType}`}>{v.assetType}</span>
                    {v.assetUrl && (
                      <a
                        className="dl"
                        href={v.assetType === 'image' ? assetProxy(v.assetUrl, true) : v.assetUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {v.assetType === 'image' ? '↓ Tải' : '↗ Mở'}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
