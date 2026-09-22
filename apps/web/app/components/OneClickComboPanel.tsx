'use client';

import React, { useState } from 'react';
import { TargetStore } from './ProductSyncPanel';

interface DeployStepLog {
  step: string;
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'skipped';
  message: string;
  timestamp: string;
}

interface OneClickComboPanelProps {
  targets: TargetStore[];
}

export function OneClickComboPanel({ targets }: OneClickComboPanelProps) {
  // Step 1: Source
  const [sourceUrl, setSourceUrl] = useState('https://overtimegearz.shop/');

  // Step 2: Target
  const [selectedTargetId, setSelectedTargetId] = useState<number | string>(targets[0]?.id || 'custom');
  const [customDomain, setCustomDomain] = useState('');
  const [customToken, setCustomToken] = useState('');

  // Step 3: Pricing & Rules
  const [priceMultiplier, setPriceMultiplier] = useState('1.25');
  const [priceAddition, setPriceAddition] = useState('0.00');
  const [priceRounding, setPriceRounding] = useState('99');
  const [overrideVendor, setOverrideVendor] = useState('');
  const [productLimit, setProductLimit] = useState<number>(0); // 0 = all

  // Execution states
  const [isRunning, setIsRunning] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentStepText, setCurrentStepText] = useState('');
  const [logs, setLogs] = useState<DeployStepLog[]>([]);
  const [resultAdminUrl, setResultAdminUrl] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleStartComboClone = async () => {
    if (!sourceUrl.trim()) {
      alert('Vui lòng nhập URL shop nguồn đối thủ!');
      return;
    }

    const options: any = {
      priceMultiplier: parseFloat(priceMultiplier) || 1.0,
      priceAddition: parseFloat(priceAddition) || 0,
      priceRounding,
      overrideVendor: overrideVendor.trim() || undefined,
      productLimit: productLimit > 0 ? productLimit : undefined,
    };

    if (selectedTargetId === 'custom') {
      if (!customDomain.trim() || !customToken.trim()) {
        alert('Vui lòng nhập đầy đủ Shopify Domain và Admin Access Token của Shop Đích!');
        return;
      }
      options.shopDomain = customDomain.trim();
      options.accessToken = customToken.trim();
    } else {
      options.targetStoreId = selectedTargetId;
    }

    setIsRunning(true);
    setIsSuccess(false);
    setErrorMsg(null);
    setResultAdminUrl(null);
    setProgressPercent(10);
    setCurrentStepText('Đang kết nối và bóc tách giao diện đối thủ...');

    setLogs([
      {
        step: 'Init',
        status: 'in_progress',
        message: `Bắt đầu tiến trình COMBO 1-CLICK từ nguồn: ${sourceUrl}`,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    try {
      setProgressPercent(25);
      const res = await fetch('/api/theme-cloner/combo-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDomain: sourceUrl,
          options,
        }),
      });

      const data = await res.json();

      if (data.result && data.result.logs) {
        setLogs(data.result.logs);
      }

      if (data.success && data.result) {
        setProgressPercent(100);
        setIsSuccess(true);
        setCurrentStepText('Hoàn tất 100%! Toàn bộ Theme và Sản phẩm đã sẵn sàng.');
        if (data.result.shopifyAdminUrl) {
          setResultAdminUrl(data.result.shopifyAdminUrl);
        } else {
          const domain = options.shopDomain || targets.find(t => t.id === Number(selectedTargetId))?.domain || '';
          setResultAdminUrl(`https://admin.shopify.com/store/${domain.replace('.myshopify.com', '')}/products`);
        }
      } else {
        throw new Error(data.message || data.result?.error || 'Có lỗi trong quá trình clone');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi xử lý combo clone');
      setLogs(prev => [
        ...prev,
        {
          step: 'Error',
          status: 'failed',
          message: `Lỗi: ${err.message}`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* HERO BANNER COMBO */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(24, 24, 27, 0.95) 0%, rgba(39, 39, 42, 0.9) 100%)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: '16px',
          padding: '2.25rem',
          boxShadow: '0 10px 30px -10px rgba(245, 158, 11, 0.2)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '2rem' }}>⚡</span>
              <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.5px' }}>
                Combo 1-Click: Bấm Phát Ăn Tất
              </h2>
              <span
                style={{
                  background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                  color: '#000',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                }}
              >
                Full Store A-Z
              </span>
            </div>
            <p style={{ margin: 0, color: '#A1A1AA', fontSize: '0.95rem', maxWidth: '820px', lineHeight: 1.6 }}>
              Nhân bản trọn gói toàn diện trong <strong>1 lần bấm duy nhất</strong>: Dựng Theme Dawn 15.2 + Banner HD gốc + Logo trong suốt + 9 Trang Pages &amp; Policies + Danh mục Collections + Menus điều hướng + Toàn bộ <strong>Sản phẩm, Biến thể &amp; Ảnh HD</strong> (tự động nhân giá). Sau khi chạy xong, anh chỉ việc bấm link mở thẳng vào acc Shopify mới để chỉnh sửa!
            </p>
          </div>
        </div>

        {/* 3 STEPS GRID */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '1.25rem',
            marginTop: '2rem',
          }}
        >
          {/* STEP 1 */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ background: '#38BDF8', color: '#000', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800 }}>1</span>
              <span style={{ fontWeight: 700, color: '#F1F5F9', fontSize: '0.95rem' }}>Shop Nguồn Đối Thủ</span>
            </div>
            <input
              type="text"
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              placeholder="VD: https://overtimegearz.shop/"
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#FFF',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            />
            <div style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
              💡 Hệ thống sẽ bóc tách Theme Dawn 15.2, Banners HD, Logo, 9 trang và toàn bộ catalog.
            </div>
          </div>

          {/* STEP 2 */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ background: '#10B981', color: '#000', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800 }}>2</span>
              <span style={{ fontWeight: 700, color: '#F1F5F9', fontSize: '0.95rem' }}>Shop Đích Của Bạn</span>
            </div>
            <select
              value={selectedTargetId}
              onChange={e => setSelectedTargetId(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#FFF',
                fontSize: '0.9rem',
                outline: 'none',
              }}
            >
              {targets.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.domain})
                </option>
              ))}
              <option value="custom">+ Nhập Shop Mới (Domain + Access Token)</option>
            </select>

            {selectedTargetId === 'custom' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                <input
                  type="text"
                  placeholder="Domain: your-shop.myshopify.com"
                  value={customDomain}
                  onChange={e => setCustomDomain(e.target.value)}
                  style={{ padding: '0.6rem', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid #475569', color: '#FFF', fontSize: '0.825rem' }}
                />
                <input
                  type="password"
                  placeholder="Admin Access Token: shpat_..."
                  value={customToken}
                  onChange={e => setCustomToken(e.target.value)}
                  style={{ padding: '0.6rem', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid #475569', color: '#FFF', fontSize: '0.825rem' }}
                />
              </div>
            )}
          </div>

          {/* STEP 3 */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ background: '#F59E0B', color: '#000', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800 }}>3</span>
              <span style={{ fontWeight: 700, color: '#F1F5F9', fontSize: '0.95rem' }}>Công Thức Giá &amp; Vendor</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Nhân giá (x):</label>
                <input
                  type="number"
                  step="0.05"
                  value={priceMultiplier}
                  onChange={e => setPriceMultiplier(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid #475569', color: '#FFF', fontSize: '0.85rem' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Làm tròn đuôi:</label>
                <select
                  value={priceRounding}
                  onChange={e => setPriceRounding(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid #475569', color: '#FFF', fontSize: '0.85rem' }}
                >
                  <option value="99">.99 (VD: $29.99)</option>
                  <option value="95">.95 (VD: $29.95)</option>
                  <option value="none">Giữ nguyên</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Đổi tên Thương hiệu / Vendor (tuỳ chọn):</label>
              <input
                type="text"
                placeholder="Để trống hoặc nhập tên brand của bạn"
                value={overrideVendor}
                onChange={e => setOverrideVendor(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', background: 'rgba(0,0,0,0.4)', border: '1px solid #475569', color: '#FFF', fontSize: '0.85rem' }}
              />
            </div>
          </div>
        </div>

        {/* GIANT ACTION BUTTON */}
        <div style={{ marginTop: '2rem' }}>
          <button
            onClick={handleStartComboClone}
            disabled={isRunning}
            style={{
              width: '100%',
              padding: '1.25rem',
              borderRadius: '12px',
              background: isRunning
                ? '#4B5563'
                : 'linear-gradient(135deg, #F59E0B 0%, #EA580C 50%, #DC2626 100%)',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 800,
              fontSize: '1.2rem',
              letterSpacing: '0.5px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              boxShadow: '0 10px 25px -5px rgba(234, 88, 12, 0.5)',
              transition: 'all 0.3s ease',
            }}
          >
            {isRunning ? (
              <>
                <span className="spinner" style={{ display: 'inline-block', width: '20px', height: '20px', border: '3px solid #FFF', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span>ĐANG CLONE TOÀN BỘ STORE (A-Z)... VUI LÒNG ĐỢI</span>
              </>
            ) : (
              <>
                <span>🚀</span>
                <span>BẤM PHÁT ĂN TẤT — CLONE TOÀN BỘ STORE (THEME + SẢN PHẨM)</span>
              </>
            )}
          </button>
        </div>

        {errorMsg && (
          <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '8px', color: '#FCA5A5', fontSize: '0.9rem' }}>
            ❌ {errorMsg}
          </div>
        )}
      </div>

      {/* SUCCESS RESULT CARD WITH DIRECT SHOPIFY ADMIN LINK */}
      {isSuccess && resultAdminUrl && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.9) 0%, rgba(4, 120, 87, 0.8) 100%)',
            border: '2px solid #34D399',
            borderRadius: '16px',
            padding: '2rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1.5rem',
            boxShadow: '0 10px 30px -5px rgba(16, 185, 129, 0.4)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.75rem' }}>🎉</span>
              <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#FFF' }}>
                CLONE THÀNH CÔNG RỰC RỠ!
              </h3>
            </div>
            <p style={{ margin: 0, color: '#D1FAE5', fontSize: '0.95rem', maxWidth: '650px', lineHeight: 1.5 }}>
              Toàn bộ giao diện Theme Dawn 15.2, Banners HD, Logo, 9 trang Policy/Pages, Danh mục Collections và toàn bộ Sản phẩm kèm ảnh đã được đẩy sang Shop Đích!
            </p>
          </div>

          <a
            href={resultAdminUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '1rem 2rem',
              background: '#FFFFFF',
              color: '#065F46',
              borderRadius: '10px',
              fontWeight: 800,
              fontSize: '1.05rem',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
              transition: 'transform 0.2s ease',
            }}
          >
            <span>👉</span> Mở Trang Quản Trị Shopify Để Chỉnh Sửa
          </a>
        </div>
      )}

      {/* LIVE PROGRESS & LOG CONSOLE */}
      {(isRunning || logs.length > 0) && (
        <div
          style={{
            background: '#090D16',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '12px',
            padding: '1.5rem',
          }}
        >
          {/* PROGRESS BAR */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <span>{currentStepText || 'Tiến độ thực thi...'}</span>
              <span style={{ fontWeight: 700, color: '#38BDF8' }}>{progressPercent}%</span>
            </div>
            <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #38BDF8 0%, #10B981 100%)',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>

          {/* LOGS LIST */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.5rem' }}>
            <span style={{ color: '#E2E8F0', fontWeight: 600, fontSize: '0.9rem' }}>💻 Nhật Ký Thực Thi Thời Gian Thực:</span>
            <span style={{ color: '#64748B', fontSize: '0.75rem' }}>{logs.length} sự kiện</span>
          </div>

          <div
            style={{
              maxHeight: '300px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              fontFamily: 'monospace',
              fontSize: '0.825rem',
            }}
          >
            {logs.map((log, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <span style={{ color: '#64748B', minWidth: '70px' }}>[{log.timestamp}]</span>
                <span
                  style={{
                    color:
                      log.status === 'success'
                        ? '#34D399'
                        : log.status === 'failed'
                        ? '#F87171'
                        : '#38BDF8',
                    fontWeight: 700,
                    minWidth: '90px',
                  }}
                >
                  {log.step}
                </span>
                <span style={{ color: '#E2E8F0', flex: 1 }}>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
