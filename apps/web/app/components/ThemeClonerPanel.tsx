'use client';

import React, { useState } from 'react';
import { TargetStore } from './ProductSyncPanel';

export interface StorefrontBlueprint {
  sourceDomain: string;
  myshopifyDomain?: string;
  themeName: string;
  themeVersion: string;
  title: string;
  announcementBarText?: string;
  logoUrl?: string;
  faviconUrl?: string;
  heroBannerUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
  colors: {
    background: string;
    foreground: string;
    button: string;
    buttonText: string;
    secondaryButton: string;
    secondaryButtonText: string;
    contrast: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
  };
  sections: string[];
  collections: Array<{ title: string; handle: string; url: string; imageUrl?: string }>;
  pages: Array<{ title: string; handle: string; url: string; bodyHtml: string }>;
  policies: Array<{ type: string; title: string; url: string; bodyHtml: string }>;
  headerMenu: Array<{ title: string; url: string; type?: string }>;
  footerMenu: Array<{ title: string; url: string; type?: string }>;
  cdnImages: string[];
  analyzedAt: string;
}

interface DeployStepLog {
  step: string;
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'skipped';
  message: string;
  timestamp: string;
}

interface ThemeClonerPanelProps {
  targets: TargetStore[];
}

export function ThemeClonerPanel({ targets }: ThemeClonerPanelProps) {
  const [sourceUrl, setSourceUrl] = useState('https://overtimegearz.shop/');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [blueprint, setBlueprint] = useState<StorefrontBlueprint | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Method 1: Export states
  const [isDownloadingTheme, setIsDownloadingTheme] = useState(false);
  const [isDownloadingContent, setIsDownloadingContent] = useState(false);

  // Method 2: Deploy states
  const [selectedTargetId, setSelectedTargetId] = useState<number | string>(targets[0]?.id || '');
  const [customDomain, setCustomDomain] = useState('');
  const [customToken, setCustomToken] = useState('');
  const [deployPages, setDeployPages] = useState(true);
  const [deployPolicies, setDeployPolicies] = useState(true);
  const [deployCollections, setDeployCollections] = useState(true);
  const [deployThemeAssets, setDeployThemeAssets] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployLogs, setDeployLogs] = useState<DeployStepLog[]>([]);
  const [deployFinished, setDeployFinished] = useState(false);

  // Modal preview
  const [activeModal, setActiveModal] = useState<{ title: string; content: string } | null>(null);

  const handleAnalyze = async () => {
    if (!sourceUrl.trim()) return;
    setIsAnalyzing(true);
    setErrorMsg(null);
    setDeployLogs([]);
    setDeployFinished(false);

    try {
      const res = await fetch('/api/theme-cloner/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: sourceUrl }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `Lỗi HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.success && data.blueprint) {
        setBlueprint(data.blueprint);
      } else {
        throw new Error('Không phân tích được giao diện');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi khi quét giao diện đối thủ');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownloadThemeZip = async () => {
    if (!blueprint) return;
    setIsDownloadingTheme(true);
    try {
      const res = await fetch('/api/theme-cloner/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint }),
      });

      if (!res.ok) throw new Error('Không thể tải file theme zip');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shopify-dawn-clone-${blueprint.sourceDomain.replace(/[^a-z0-9]/gi, '_')}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Lỗi tải theme: ${err.message}`);
    } finally {
      setIsDownloadingTheme(false);
    }
  };

  const handleDownloadContentZip = async () => {
    if (!blueprint) return;
    setIsDownloadingContent(true);
    try {
      const res = await fetch('/api/theme-cloner/export-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint }),
      });

      if (!res.ok) throw new Error('Không thể tải file nội dung');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `storefront-content-${blueprint.sourceDomain.replace(/[^a-z0-9]/gi, '_')}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Lỗi tải nội dung: ${err.message}`);
    } finally {
      setIsDownloadingContent(false);
    }
  };

  const handleDeployDirect = async () => {
    if (!blueprint) return;
    setIsDeploying(true);
    setDeployLogs([]);
    setDeployFinished(false);

    try {
      const options: any = {
        deployPages,
        deployPolicies,
        deployCollections,
        deployThemeAssets,
      };

      if (selectedTargetId === 'custom') {
        if (!customDomain.trim() || !customToken.trim()) {
          alert('Vui lòng nhập đầy đủ Domain và Access Token của Shop Đích!');
          setIsDeploying(false);
          return;
        }
        options.shopDomain = customDomain.trim();
        options.accessToken = customToken.trim();
      } else {
        options.targetStoreId = selectedTargetId;
      }

      setDeployLogs([{
        step: 'Init',
        status: 'in_progress',
        message: 'Bắt đầu gửi lệnh triển khai đến hệ thống...',
        timestamp: new Date().toLocaleTimeString(),
      }]);

      const res = await fetch('/api/theme-cloner/deploy-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blueprint, options }),
      });

      const result = await res.json();
      if (result.logs && Array.isArray(result.logs)) {
        setDeployLogs(result.logs);
      }

      if (result.success) {
        setDeployFinished(true);
      } else {
        alert(`Triển khai thất bại: ${result.error || 'Có lỗi xảy ra'}`);
      }
    } catch (err: any) {
      alert(`Lỗi kết nối deploy: ${err.message}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* HEADER HERO */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '12px',
          padding: '2rem',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.75rem' }}>🎨</span>
              <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#F8FAFC' }}>
                Shopify Theme & Storefront Cloner
              </h2>
              <span
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38BDF8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                Dawn 15.2.0 OS 2.0 Engine
              </span>
            </div>
            <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.925rem', maxWidth: '750px', lineHeight: 1.5 }}>
              Tự động cào bóc tách toàn bộ giao diện: Banner HD, Logo trong suốt, Bảng màu, Font chữ, 9 trang Pages/Policies và Menus. Hỗ trợ xuất <strong>File Theme Zip</strong> cài đặt 1-click hoặc <strong>Triển khai trực tiếp qua Shopify API</strong>.
            </p>
          </div>
        </div>

        {/* INPUT BAR */}
        <div style={{ marginTop: '1.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '320px', position: 'relative' }}>
            <input
              type="text"
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              placeholder="Nhập domain shop đối thủ (VD: https://overtimegearz.shop/)"
              style={{
                width: '100%',
                padding: '0.85rem 1.25rem',
                borderRadius: '8px',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#F8FAFC',
                fontSize: '0.95rem',
                outline: 'none',
              }}
            />
          </div>
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !sourceUrl.trim()}
            style={{
              padding: '0.85rem 2rem',
              borderRadius: '8px',
              background: isAnalyzing ? '#475569' : 'linear-gradient(135deg, #0284C7 0%, #2563EB 100%)',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: isAnalyzing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
              transition: 'all 0.2s ease',
            }}
          >
            {isAnalyzing ? (
              <>
                <span className="spinner" style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid #FFF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                Đang quét bóc tách...
              </>
            ) : (
              <>
                <span>⚡</span> Quét Giao Diện
              </>
            )}
          </button>
        </div>

        {errorMsg && (
          <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#FCA5A5', fontSize: '0.875rem' }}>
            ⚠️ {errorMsg}
          </div>
        )}
      </div>

      {/* BLUEPRINT SUMMARY SECTION */}
      {blueprint && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* STATS STRIP */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
            }}
          >
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ color: '#94A3B8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Theme Engine</div>
              <div style={{ color: '#38BDF8', fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>{blueprint.themeName} v{blueprint.themeVersion}</div>
              <div style={{ color: '#64748B', fontSize: '0.75rem', marginTop: '0.25rem' }}>{blueprint.myshopifyDomain || blueprint.sourceDomain}</div>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ color: '#94A3B8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pages & Policies</div>
              <div style={{ color: '#10B981', fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {blueprint.pages.length} Pages + {blueprint.policies.length} Policies
              </div>
              <div style={{ color: '#64748B', fontSize: '0.75rem', marginTop: '0.25rem' }}>Đã bóc tách toàn bộ mã HTML</div>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ color: '#94A3B8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Danh mục & Menu</div>
              <div style={{ color: '#F59E0B', fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>
                {blueprint.collections.length} Collections
              </div>
              <div style={{ color: '#64748B', fontSize: '0.75rem', marginTop: '0.25rem' }}>Header ({blueprint.headerMenu.length}) | Footer ({blueprint.footerMenu.length})</div>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.5)', padding: '1.25rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ color: '#94A3B8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Typography & Màu</div>
              <div style={{ color: '#E2E8F0', fontSize: '1.1rem', fontWeight: 600, marginTop: '0.25rem' }}>
                {blueprint.typography.headingFont} / {blueprint.typography.bodyFont}
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem' }}>
                {[blueprint.colors.background, blueprint.colors.foreground, blueprint.colors.button, blueprint.colors.secondaryButton].map((c, i) => (
                  <span key={i} style={{ width: '16px', height: '16px', borderRadius: '50%', background: c, border: '1px solid #475569' }} title={c} />
                ))}
              </div>
            </div>
          </div>

          {/* ASSET PREVIEWS: LOGO & BANNER */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
            {/* HERO BANNER CARD */}
            <div style={{ background: 'rgba(30, 41, 59, 0.4)', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
              <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#F1F5F9', fontSize: '0.9rem' }}>🖼️ Hero Banner</span>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>CTA: {blueprint.ctaText || 'Shop now'}</span>
              </div>
              <div style={{ position: 'relative', height: '200px', background: '#090D16', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {blueprint.heroBannerUrl ? (
                  <img
                    src={blueprint.heroBannerUrl}
                    alt="Hero Banner"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{ color: '#64748B' }}>Không tìm thấy ảnh banner</span>
                )}
                <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.7)', padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', color: '#FFF' }}>
                  {blueprint.ctaText} ➔ {blueprint.ctaUrl}
                </div>
              </div>
            </div>

            {/* LOGO & COLOR SCHEME CARD */}
            <div style={{ background: 'rgba(30, 41, 59, 0.4)', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
              <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#F1F5F9', fontSize: '0.9rem' }}>🏷️ Logo & Bảng Màu</span>
                <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{blueprint.title}</span>
              </div>
              <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ height: '90px', background: '#0F172A', border: '1px dashed rgba(255, 255, 255, 0.15)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}>
                  {blueprint.logoUrl ? (
                    <img src={blueprint.logoUrl} alt="Store Logo" style={{ maxHeight: '75px', maxWidth: '100%', objectFit: 'contain' }} />
                  ) : (
                    <span style={{ color: '#64748B', fontSize: '0.85rem' }}>{blueprint.title} (Text Logo)</span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.75rem' }}>
                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.5rem', borderRadius: '4px' }}>
                    <div style={{ color: '#94A3B8' }}>Background</div>
                    <div style={{ fontWeight: 600, color: '#FFF', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                      <span style={{ width: '12px', height: '12px', background: blueprint.colors.background, border: '1px solid #64748B', display: 'inline-block' }} />
                      {blueprint.colors.background}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.5rem', borderRadius: '4px' }}>
                    <div style={{ color: '#94A3B8' }}>Text / Font</div>
                    <div style={{ fontWeight: 600, color: '#FFF', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                      <span style={{ width: '12px', height: '12px', background: blueprint.colors.foreground, border: '1px solid #64748B', display: 'inline-block' }} />
                      {blueprint.colors.foreground}
                    </div>
                  </div>

                  <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.5rem', borderRadius: '4px' }}>
                    <div style={{ color: '#94A3B8' }}>Buttons</div>
                    <div style={{ fontWeight: 600, color: '#FFF', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                      <span style={{ width: '12px', height: '12px', background: blueprint.colors.button, border: '1px solid #64748B', display: 'inline-block' }} />
                      {blueprint.colors.button}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TWO MAIN CLONING OPTIONS: SIDE BY SIDE */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
            {/* OPTION 1: DOWNLOAD THEME ZIP */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.7) 100%)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '12px',
                padding: '1.75rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>📦</span>
                  <h3 style={{ margin: 0, color: '#38BDF8', fontSize: '1.2rem' }}>
                    Phương Pháp 1: Tải Trọn Bộ Theme Zip (Offline)
                  </h3>
                </div>
                <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.875rem', lineHeight: 1.5 }}>
                  Hệ thống đã tự động đóng gói toàn bộ Theme <strong>Dawn 15.2.0</strong> kèm các file ảnh HD banner, logo, bố cục Section và bảng màu.
                </p>

                <div style={{ marginTop: '1.25rem', background: 'rgba(15, 23, 42, 0.6)', padding: '1rem', borderRadius: '8px', fontSize: '0.825rem', color: '#CBD5E1' }}>
                  <div style={{ fontWeight: 600, color: '#F1F5F9', marginBottom: '0.5rem' }}>3 Bước Cài Đặt Lên Shop Mới:</div>
                  <ol style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <li>Vào <strong>Shopify Admin &gt; Online Store &gt; Themes</strong>.</li>
                    <li>Ở mục <em>Theme library</em>, bấm <strong>Add theme &gt; Upload zip file</strong>.</li>
                    <li>Chọn file vừa tải và bấm <strong>Publish</strong> để kích hoạt.</li>
                  </ol>
                </div>
              </div>

              <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button
                  onClick={handleDownloadThemeZip}
                  disabled={isDownloadingTheme}
                  style={{
                    width: '100%',
                    padding: '0.85rem',
                    background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {isDownloadingTheme ? 'Đang đóng gói Theme...' : '⬇️ Tải File Theme (.ZIP) Chuẩn Shopify'}
                </button>

                <button
                  onClick={handleDownloadContentZip}
                  disabled={isDownloadingContent}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'rgba(51, 65, 85, 0.5)',
                    color: '#E2E8F0',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                  }}
                >
                  {isDownloadingContent ? 'Đang tải nội dung...' : '📄 Tải Bộ 9 Trang Pages & Policies (HTML/JSON)'}
                </button>
              </div>
            </div>

            {/* OPTION 2: LIVE API DEPLOY */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.7) 100%)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '12px',
                padding: '1.75rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>🚀</span>
                  <h3 style={{ margin: 0, color: '#34D399', fontSize: '1.2rem' }}>
                    Phương Pháp 2: Triển Khai Trực Tiếp Qua API
                  </h3>
                </div>
                <p style={{ margin: 0, color: '#94A3B8', fontSize: '0.875rem', lineHeight: 1.5 }}>
                  Kết nối trực tiếp vào Store đích để tự động tạo Pages, Policies, Collections, Menus và cập nhật Theme Assets.
                </p>

                {/* TARGET STORE PICKER */}
                <div style={{ marginTop: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.825rem', color: '#CBD5E1', marginBottom: '0.35rem', fontWeight: 500 }}>
                    Chọn Shop Đích (Target Store):
                  </label>
                  <select
                    value={selectedTargetId}
                    onChange={e => setSelectedTargetId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      color: '#FFF',
                      fontSize: '0.875rem',
                      outline: 'none',
                    }}
                  >
                    {targets.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.domain})
                      </option>
                    ))}
                    <option value="custom">+ Nhập Shop Mới Thủ Công (Domain + Token)</option>
                  </select>

                  {selectedTargetId === 'custom' && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Domain: your-store.myshopify.com"
                        value={customDomain}
                        onChange={e => setCustomDomain(e.target.value)}
                        style={{ padding: '0.6rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid #475569', color: '#FFF', fontSize: '0.85rem' }}
                      />
                      <input
                        type="password"
                        placeholder="Admin Access Token: shpat_..."
                        value={customToken}
                        onChange={e => setCustomToken(e.target.value)}
                        style={{ padding: '0.6rem', borderRadius: '4px', background: 'rgba(0,0,0,0.5)', border: '1px solid #475569', color: '#FFF', fontSize: '0.85rem' }}
                      />
                    </div>
                  )}
                </div>

                {/* DEPLOY CHECKBOXES */}
                <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.825rem', color: '#CBD5E1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={deployPages} onChange={e => setDeployPages(e.target.checked)} />
                    Tạo {blueprint.pages.length} Trang Pages
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={deployPolicies} onChange={e => setDeployPolicies(e.target.checked)} />
                    Tạo {blueprint.policies.length} Trang Policies
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={deployCollections} onChange={e => setDeployCollections(e.target.checked)} />
                    Tạo {blueprint.collections.length} Collections
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={deployThemeAssets} onChange={e => setDeployThemeAssets(e.target.checked)} />
                    Đẩy Banner & Logo Theme
                  </label>
                </div>
              </div>

              <div style={{ marginTop: '1.5rem' }}>
                <button
                  onClick={handleDeployDirect}
                  disabled={isDeploying}
                  style={{
                    width: '100%',
                    padding: '0.85rem',
                    background: isDeploying ? '#475569' : 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    cursor: isDeploying ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {isDeploying ? 'Đang đồng bộ giao diện...' : '🚀 Bắt Đầu Triển Khai Tự Động Sang Shop Đích'}
                </button>
              </div>
            </div>
          </div>

          {/* DEPLOYMENT TERMINAL LOG CONSOLE */}
          {deployLogs.length > 0 && (
            <div
              style={{
                marginTop: '1rem',
                background: '#0B0F17',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '1.25rem',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.5rem' }}>
                <span style={{ color: '#38BDF8', fontWeight: 600 }}>💻 Tiến trình triển khai (Live Deployment Logs)</span>
                {deployFinished && (
                  <span style={{ color: '#34D399', fontWeight: 600 }}>✅ HOÀN TẤT TRIỂN KHAI</span>
                )}
              </div>
              <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {deployLogs.map((log, index) => (
                  <div key={index} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <span style={{ color: '#64748B' }}>[{log.timestamp}]</span>
                    <span
                      style={{
                        color:
                          log.status === 'success'
                            ? '#34D399'
                            : log.status === 'failed'
                            ? '#F87171'
                            : '#38BDF8',
                        fontWeight: 600,
                        minWidth: '70px',
                      }}
                    >
                      {log.step}
                    </span>
                    <span style={{ color: '#E2E8F0' }}>{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SCRAPED PAGES & POLICIES VIEWER */}
          <div
            style={{
              background: 'rgba(30, 41, 59, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '1.5rem',
              marginTop: '1rem',
            }}
          >
            <h3 style={{ margin: '0 0 1rem 0', color: '#F1F5F9', fontSize: '1.1rem' }}>
              📑 Chi Tiết 9 Trang Nội Dung & Chính Sách Đã Bóc Tách
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
              {blueprint.pages.map(page => (
                <div
                  key={page.handle}
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#E2E8F0', fontSize: '0.875rem' }}>{page.title}</div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem' }}>/pages/{page.handle}</div>
                  </div>
                  <button
                    onClick={() => setActiveModal({ title: page.title, content: page.bodyHtml })}
                    style={{
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#38BDF8',
                      padding: '0.3rem 0.6rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Xem HTML
                  </button>
                </div>
              ))}

              {blueprint.policies.map(policy => (
                <div
                  key={policy.url}
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#E2E8F0', fontSize: '0.875rem' }}>{policy.title}</div>
                    <div style={{ color: '#64748B', fontSize: '0.75rem' }}>{policy.url}</div>
                  </div>
                  <button
                    onClick={() => setActiveModal({ title: policy.title, content: policy.bodyHtml })}
                    style={{
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#34D399',
                      padding: '0.3rem 0.6rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Xem HTML
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* HTML PREVIEW MODAL */}
      {activeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1.5rem',
          }}
        >
          <div
            style={{
              background: '#0F172A',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '12px',
              maxWidth: '800px',
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#F1F5F9', fontSize: '1.1rem' }}>{activeModal.title}</h3>
              <button
                onClick={() => setActiveModal(null)}
                style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '1.25rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, color: '#CBD5E1', fontSize: '0.9rem', lineHeight: 1.6 }}>
              <div dangerouslySetInnerHTML={{ __html: activeModal.content }} />
            </div>
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(activeModal.content);
                  alert('Đã copy mã HTML vào clipboard!');
                }}
                style={{ padding: '0.5rem 1rem', background: '#334155', color: '#FFF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                📋 Copy HTML
              </button>
              <button
                onClick={() => setActiveModal(null)}
                style={{ padding: '0.5rem 1rem', background: '#2563EB', color: '#FFF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
