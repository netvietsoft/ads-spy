'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { ThemeClonerPanel } from './ThemeClonerPanel';

export interface SourceStore {
  id: number;
  name: string;
  domain: string;
  platform: string;
  status: string;
  cronEnabled: boolean;
  checkIntervalMinutes: number;
  lastScrapedAt: string | null;
  lastStatusMessage: string | null;
  productCount: number;
  createdAt: string;
  _count?: { products: number; rules: number };
}

export interface TargetStore {
  id: number;
  name: string;
  domain: string;
  platform: string;
  accessToken: string | null;
  apiVersion: string;
  status: string;
  createdAt: string;
  _count?: { rules: number; syncLogs: number };
}

export interface SyncRuleItem {
  id: number;
  name: string;
  sourceStoreId: number;
  targetStoreId: number;
  enabled: boolean;
  priceMultiplier: number;
  priceAddition: number;
  priceRounding: string;
  overrideVendor: string | null;
  tagAction: string;
  tagsToAdd: string | null;
  titlePrefix: string | null;
  titleSuffix: string | null;
  removeWords: string | null;
  productStatus: string;
  sourceStore?: { id: number; name: string; domain: string };
  targetStore?: { id: number; name: string; domain: string };
}

export interface SyncProductItem {
  id: number;
  sourceStoreId: number;
  sourceProductId: string;
  handle: string;
  title: string;
  bodyHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string | null;
  optionsRaw: string;
  variantsRaw: string;
  imagesRaw: string;
  sourcePublishedAt: string | null;
  createdAt: string;
  sourceStore?: { id: number; name: string; domain: string };
  syncLogs?: Array<{
    id: number;
    status: string;
    targetProductId: string | null;
    targetStore?: { id: number; name: string; domain: string };
  }>;
}

export interface SyncLogItem {
  id: number;
  syncProductId: number;
  targetStoreId: number;
  targetProductId: string | null;
  status: string;
  errorMessage: string | null;
  syncedAt: string;
  syncProduct?: {
    id: number;
    title: string;
    handle: string;
    sourceStore?: { domain: string };
  };
  targetStore?: {
    id: number;
    name: string;
    domain: string;
  };
}

export function ProductSyncPanel() {
  const [subTab, setSubTab] = useState<'catalog' | 'sources' | 'targets' | 'rules' | 'theme'>('catalog');

  // Sources
  const [sources, setSources] = useState<SourceStore[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [newSourceDomain, setNewSourceDomain] = useState('');
  const [isBulkSource, setIsBulkSource] = useState(false);
  const [scanningSourceId, setScanningSourceId] = useState<number | null>(null);

  // Targets
  const [targets, setTargets] = useState<TargetStore[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [newTargetName, setNewTargetName] = useState('');
  const [newTargetDomain, setNewTargetDomain] = useState('');
  const [newTargetToken, setNewTargetToken] = useState('');
  const [testingTargetId, setTestingTargetId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ [id: number]: string }>({});

  // Rules
  const [rules, setRules] = useState<SyncRuleItem[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [ruleSourceId, setRuleSourceId] = useState<number>(0);
  const [ruleTargetId, setRuleTargetId] = useState<number>(0);
  const [rulePriceMult, setRulePriceMult] = useState('1.25');
  const [rulePriceAdd, setRulePriceAdd] = useState('0.00');
  const [ruleRounding, setRuleRounding] = useState('99');
  const [ruleVendor, setRuleVendor] = useState('');
  const [ruleRemoveWords, setRuleRemoveWords] = useState('');
  const [ruleStatus, setRuleStatus] = useState('active');

  // Products
  const [products, setProducts] = useState<SyncProductItem[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [filterSource, setFilterSource] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);

  // Logs
  const [logs, setLogs] = useState<SyncLogItem[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Modals
  const [previewProduct, setPreviewProduct] = useState<SyncProductItem | null>(null);
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushTargetIds, setPushTargetIds] = useState<number[]>([]);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResultMsg, setPushResultMsg] = useState('');

  // Notifications
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // Load Data Handlers
  const fetchSources = async () => {
    setLoadingSources(true);
    try {
      const res = await fetch('/api/product-sync/sources');
      if (res.ok) {
        const data = await res.json();
        setSources(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSources(false);
    }
  };

  const fetchTargets = async () => {
    setLoadingTargets(true);
    try {
      const res = await fetch('/api/product-sync/targets');
      if (res.ok) {
        const data = await res.json();
        setTargets(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingTargets(false);
    }
  };

  const fetchRules = async () => {
    setLoadingRules(true);
    try {
      const res = await fetch('/api/product-sync/rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingRules(false);
    }
  };

  const fetchProducts = async (p = 1, src = filterSource, q = searchQuery) => {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: '25',
      });
      if (src) params.append('sourceStoreId', src);
      if (q) params.append('q', q);

      const res = await fetch(`/api/product-sync/products?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.items || []);
        setTotalProducts(data.total || 0);
        setPage(p);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingProducts(false);
    }
  };

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch('/api/product-sync/logs?limit=50');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchSources();
    fetchTargets();
    fetchRules();
    fetchProducts(1);
    fetchLogs();
  }, []);

  // Source Store Actions
  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceDomain.trim()) return;

    try {
      const rawDomains = isBulkSource
        ? newSourceDomain.split(/[\r\n,;\s]+/).map((d) => d.trim()).filter(Boolean)
        : [newSourceDomain.trim()];

      const res = await fetch('/api/product-sync/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: rawDomains }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        showMsg(`Đã thêm thành công ${data.count} shop nguồn!`);
        setNewSourceDomain('');
        fetchSources();
      } else {
        showMsg(data.message || 'Lỗi thêm shop nguồn', 'error');
      }
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleScanSource = async (id: number) => {
    setScanningSourceId(id);
    try {
      const res = await fetch(`/api/product-sync/sources/${id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 25 }),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        showMsg(`Quét thành công! Tìm thấy ${data.totalFound} sản phẩm (+${data.newCount} mới, ${data.updatedCount} cập nhật)`);
        fetchSources();
        fetchProducts(1);
      } else {
        showMsg(`Kết quả quét: ${data.message || data.status}`, 'error');
      }
    } catch (err: any) {
      showMsg(err.message, 'error');
    } finally {
      setScanningSourceId(null);
    }
  };

  const handleDeleteSource = async (id: number) => {
    if (!confirm('Bạn có chắc muốn xoá shop nguồn này? Toàn bộ sản phẩm liên quan trong kho đệm sẽ bị xoá.')) return;
    try {
      const res = await fetch(`/api/product-sync/sources/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showMsg('Đã xoá shop nguồn');
        fetchSources();
        fetchProducts(1);
      }
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleToggleCron = async (id: number, current: boolean) => {
    try {
      const res = await fetch(`/api/product-sync/sources/${id}/toggle-cron`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !current }),
      });
      if (res.ok) {
        fetchSources();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Target Store Actions
  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTargetDomain.trim()) return;

    try {
      const res = await fetch('/api/product-sync/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTargetName.trim() || newTargetDomain.trim(),
          domain: newTargetDomain.trim(),
          accessToken: newTargetToken.trim() || null,
        }),
      });

      if (res.ok) {
        showMsg('Đã thêm shop đích thành công!');
        setNewTargetName('');
        setNewTargetDomain('');
        setNewTargetToken('');
        fetchTargets();
      } else {
        const err = await res.json();
        showMsg(err.message || 'Lỗi thêm shop đích', 'error');
      }
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleTestTarget = async (id: number) => {
    setTestingTargetId(id);
    setTestResult((prev) => ({ ...prev, [id]: 'Đang kiểm tra kết nối...' }));
    try {
      const res = await fetch(`/api/product-sync/targets/${id}/test`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setTestResult((prev) => ({ ...prev, [id]: `✅ ${data.message}` }));
        showMsg(data.message);
      } else {
        setTestResult((prev) => ({ ...prev, [id]: `❌ ${data.message}` }));
        showMsg(data.message, 'error');
      }
      fetchTargets();
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [id]: `❌ Lỗi: ${err.message}` }));
    } finally {
      setTestingTargetId(null);
    }
  };

  const handleDeleteTarget = async (id: number) => {
    if (!confirm('Bạn có chắc muốn xoá shop đích này?')) return;
    try {
      const res = await fetch(`/api/product-sync/targets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showMsg('Đã xoá shop đích');
        fetchTargets();
      }
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  // Rule Actions
  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleSourceId || !ruleTargetId) {
      showMsg('Vui lòng chọn cả Shop Nguồn và Shop Đích!', 'error');
      return;
    }

    try {
      const res = await fetch('/api/product-sync/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceStoreId: Number(ruleSourceId),
          targetStoreId: Number(ruleTargetId),
          priceMultiplier: parseFloat(rulePriceMult) || 1.0,
          priceAddition: parseFloat(rulePriceAdd) || 0.0,
          priceRounding: ruleRounding,
          overrideVendor: ruleVendor.trim() || undefined,
          removeWords: ruleRemoveWords.trim() || undefined,
          productStatus: ruleStatus,
          enabled: true,
        }),
      });

      if (res.ok) {
        showMsg('Đã lưu quy tắc đồng bộ thành công!');
        fetchRules();
      } else {
        const err = await res.json();
        showMsg(err.message || 'Lỗi lưu quy tắc', 'error');
      }
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleDeleteRule = async (id: number) => {
    try {
      const res = await fetch(`/api/product-sync/rules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showMsg('Đã xoá quy tắc');
        fetchRules();
      }
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  // Push Actions
  const handleOpenPushModal = () => {
    if (selectedProductIds.length === 0) {
      showMsg('Vui lòng tích chọn ít nhất 1 sản phẩm để đồng bộ!', 'error');
      return;
    }
    setPushModalOpen(true);
    setPushResultMsg('');
  };

  const handleExecutePush = async () => {
    if (pushTargetIds.length === 0) {
      showMsg('Vui lòng chọn ít nhất 1 shop đích!', 'error');
      return;
    }

    setIsPushing(true);
    setPushResultMsg('Đang gửi lệnh đồng bộ lên các shop đích...');
    try {
      const res = await fetch('/api/product-sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: selectedProductIds,
          targetStoreIds: pushTargetIds,
          config: {
            priceMultiplier: parseFloat(rulePriceMult) || 1.25,
            priceAddition: parseFloat(rulePriceAdd) || 0.0,
            priceRounding: ruleRounding as any,
            overrideVendor: ruleVendor || undefined,
            removeWords: ruleRemoveWords || undefined,
            productStatus: ruleStatus as any,
          },
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setPushResultMsg(`🎉 Hoàn tất: ${data.success} thành công, ${data.failed} lỗi (Tổng ${data.total} lượt đẩy).`);
        showMsg(`Đã đồng bộ thành công ${data.success} sản phẩm!`);
        fetchProducts(page);
        fetchLogs();
      } else {
        setPushResultMsg(`❌ Lỗi: ${data.message}`);
        showMsg(data.message, 'error');
      }
    } catch (err: any) {
      setPushResultMsg(`❌ Lỗi: ${err.message}`);
    } finally {
      setIsPushing(false);
    }
  };

  // Export CSV Action
  const handleExportCsv = async () => {
    try {
      showMsg('Đang xuất file CSV chuẩn Shopify...');
      const res = await fetch('/api/product-sync/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: selectedProductIds.length > 0 ? selectedProductIds : undefined,
          sourceStoreId: filterSource ? Number(filterSource) : undefined,
          config: {
            priceMultiplier: parseFloat(rulePriceMult) || 1.0,
            priceAddition: parseFloat(rulePriceAdd) || 0.0,
            priceRounding: ruleRounding as any,
            overrideVendor: ruleVendor || undefined,
            removeWords: ruleRemoveWords || undefined,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        showMsg(err.message || 'Lỗi xuất file CSV', 'error');
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shopify-products-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showMsg('Tải file CSV thành công!');
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  // Select all helper
  const allCurrentPageSelected = products.length > 0 && products.every((p) => selectedProductIds.includes(p.id));
  const toggleSelectAll = () => {
    if (allCurrentPageSelected) {
      const pageIds = products.map((p) => p.id);
      setSelectedProductIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      const pageIds = products.map((p) => p.id);
      setSelectedProductIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedProductIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  return (
    <div className="product-sync-container" style={{ padding: '16px 0', minHeight: '80vh' }}>
      {/* Header & Sub-Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🔄</span> Product Sync Hub — Cào đa nguồn & Đồng bộ Shop
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            Cào toàn bộ catalog đối thủ (variants, options, ảnh HD), tự động hoá phát hiện hàng mới bằng Cron Job và đồng bộ 1-N / N-1 lên các shop của bạn.
          </p>
        </div>

        {/* Action Quick Stats */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ padding: '6px 14px', background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>SHOP NGUỒN</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#2563eb' }}>{sources.length}</div>
          </div>
          <div style={{ padding: '6px 14px', background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>SHOP ĐÍCH</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{targets.length}</div>
          </div>
          <div style={{ padding: '6px 14px', background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>SẢN PHẨM TRONG KHO</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#9333ea' }}>{totalProducts}</div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div
          style={{
            padding: '10px 16px',
            marginBottom: 16,
            borderRadius: 8,
            backgroundColor: message.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: message.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${message.type === 'success' ? '#86efac' : '#fca5a5'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '2px solid var(--border, #e5e7eb)', marginBottom: 20 }}>
        <button
          onClick={() => setSubTab('catalog')}
          style={{
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            border: 'none',
            background: 'none',
            borderBottom: subTab === 'catalog' ? '3px solid #2563eb' : '3px solid transparent',
            color: subTab === 'catalog' ? '#2563eb' : 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          📦 Kho sản phẩm ({totalProducts})
        </button>
        <button
          onClick={() => setSubTab('sources')}
          style={{
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            border: 'none',
            background: 'none',
            borderBottom: subTab === 'sources' ? '3px solid #2563eb' : '3px solid transparent',
            color: subTab === 'sources' ? '#2563eb' : 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          🎯 Shop Nguồn đối thủ ({sources.length})
        </button>
        <button
          onClick={() => setSubTab('targets')}
          style={{
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            border: 'none',
            background: 'none',
            borderBottom: subTab === 'targets' ? '3px solid #2563eb' : '3px solid transparent',
            color: subTab === 'targets' ? '#2563eb' : 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          🏪 Shop Đích của bạn ({targets.length})
        </button>
        <button
          onClick={() => setSubTab('rules')}
          style={{
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            border: 'none',
            background: 'none',
            borderBottom: subTab === 'rules' ? '3px solid #2563eb' : '3px solid transparent',
            color: subTab === 'rules' ? '#2563eb' : 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ⚡ Quy tắc & Nhật ký Cron ({rules.length})
        </button>
        <button
          onClick={() => setSubTab('theme')}
          style={{
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            border: 'none',
            background: 'none',
            borderBottom: subTab === 'theme' ? '3px solid #0284c7' : '3px solid transparent',
            color: subTab === 'theme' ? '#0284c7' : 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          🎨 Theme & Giao diện (Cloner)
        </button>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: KHO SẢN PHẨM (CATALOG) */}
      {/* ==================================================================== */}
      {subTab === 'catalog' && (
        <div>
          {/* Controls Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 16,
              background: 'var(--card-bg, #fff)',
              padding: '12px 16px',
              borderRadius: 8,
              border: '1px solid var(--border, #e5e7eb)',
            }}
          >
            {/* Filter & Search */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="🔍 Tìm tên sản phẩm, handle, vendor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fetchProducts(1, filterSource, searchQuery); }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border, #d1d5db)',
                  fontSize: 13,
                  minWidth: 260,
                }}
              />
              <select
                value={filterSource}
                onChange={(e) => { setFilterSource(e.target.value); fetchProducts(1, e.target.value, searchQuery); }}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
              >
                <option value="">-- Tất cả shop nguồn --</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.domain}</option>
                ))}
              </select>
              <button
                onClick={() => fetchProducts(1, filterSource, searchQuery)}
                style={{ padding: '8px 14px', borderRadius: 6, background: '#2563eb', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
              >
                Lọc
              </button>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)', marginRight: 4 }}>
                Đã chọn: <b>{selectedProductIds.length}</b> sản phẩm
              </span>
              <button
                onClick={handleOpenPushModal}
                disabled={selectedProductIds.length === 0}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  background: selectedProductIds.length > 0 ? '#16a34a' : '#9ca3af',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: selectedProductIds.length > 0 ? 'pointer' : 'not-allowed',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                🚀 Đẩy sang Shop Đích...
              </button>
              <button
                onClick={handleExportCsv}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  background: '#f59e0b',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                📥 Xuất CSV chuẩn Shopify
              </button>
            </div>
          </div>

          {/* Products Table */}
          <div style={{ overflowX: 'auto', background: 'var(--card-bg, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--table-head, #f9fafb)', borderBottom: '1px solid var(--border, #e5e7eb)', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px', width: 40 }}>
                    <input type="checkbox" checked={allCurrentPageSelected} onChange={toggleSelectAll} />
                  </th>
                  <th style={{ padding: '10px 12px', width: 64 }}>Ảnh</th>
                  <th style={{ padding: '10px 12px' }}>Tên Sản Phẩm & Handle</th>
                  <th style={{ padding: '10px 12px' }}>Shop Nguồn</th>
                  <th style={{ padding: '10px 12px' }}>Giá Bán</th>
                  <th style={{ padding: '10px 12px' }}>Biến thể (Variants)</th>
                  <th style={{ padding: '10px 12px' }}>Trạng thái Sync</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', width: 90 }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loadingProducts ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Đang tải danh sách sản phẩm...</td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                      Chưa có sản phẩm nào trong kho đệm. Hãy thêm shop nguồn ở tab <b>Shop Nguồn đối thủ</b> và bấm <b>Quét ngay</b>!
                    </td>
                  </tr>
                ) : (
                  products.map((p) => {
                    let firstImg = '';
                    try {
                      const imgs = JSON.parse(p.imagesRaw || '[]');
                      firstImg = imgs[0]?.src || '';
                    } catch {}

                    let variants: any[] = [];
                    try {
                      variants = JSON.parse(p.variantsRaw || '[]');
                    } catch {}

                    const prices = variants.map((v) => parseFloat(v.price)).filter((n) => !isNaN(n));
                    const minPrice = prices.length ? Math.min(...prices) : 0;
                    const maxPrice = prices.length ? Math.max(...prices) : 0;
                    const priceDisplay = minPrice === maxPrice ? `$${minPrice.toFixed(2)}` : `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;

                    const isSelected = selectedProductIds.includes(p.id);

                    return (
                      <tr
                        key={p.id}
                        style={{
                          borderBottom: '1px solid var(--border, #f3f4f6)',
                          backgroundColor: isSelected ? 'rgba(37, 99, 235, 0.04)' : undefined,
                        }}
                      >
                        <td style={{ padding: '10px 12px' }}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelectOne(p.id)} />
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {firstImg ? (
                            <img
                              src={firstImg}
                              alt=""
                              style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border, #e5e7eb)' }}
                              onError={(e) => { (e.target as any).style.display = 'none'; }}
                            />
                          ) : (
                            <div style={{ width: 44, height: 44, background: '#f3f4f6', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🖼️</div>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', maxWidth: 360 }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-main, #111827)', marginBottom: 2, lineHeight: 1.3 }}>
                            {p.title}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                            /{p.handle}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, background: '#e0f2fe', color: '#0369a1', fontSize: 12, fontWeight: 500 }}>
                            {p.sourceStore?.domain || 'Unknown'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#059669' }}>
                          {priceDisplay}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {variants.length} options / variants
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {p.syncLogs && p.syncLogs.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {p.syncLogs.map((l) => (
                                <span
                                  key={l.id}
                                  style={{
                                    fontSize: 11,
                                    color: l.status === 'success' ? '#15803d' : '#b91c1c',
                                    fontWeight: 500,
                                  }}
                                >
                                  {l.status === 'success' ? '✅ Đã sync' : '❌ Lỗi'}: {l.targetStore?.name || l.targetStore?.domain}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>Chưa sync</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <button
                            onClick={() => setPreviewProduct(p)}
                            style={{ padding: '4px 8px', fontSize: 12, background: 'none', border: '1px solid var(--border, #d1d5db)', borderRadius: 4, cursor: 'pointer' }}
                          >
                            Xem chi tiết ▸
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              Trang {page} / {Math.max(1, Math.ceil(totalProducts / 25))} (Tổng cộng {totalProducts} sản phẩm)
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                disabled={page <= 1}
                onClick={() => fetchProducts(page - 1)}
                style={{ padding: '6px 12px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border, #d1d5db)', background: 'none', cursor: page > 1 ? 'pointer' : 'not-allowed' }}
              >
                ◀ Trang trước
              </button>
              <button
                disabled={page * 25 >= totalProducts}
                onClick={() => fetchProducts(page + 1)}
                style={{ padding: '6px 12px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border, #d1d5db)', background: 'none', cursor: page * 25 < totalProducts ? 'pointer' : 'not-allowed' }}
              >
                Trang kế tiếp ▶
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: CỬA HÀNG NGUỒN (SOURCE STORES) */}
      {/* ==================================================================== */}
      {subTab === 'sources' && (
        <div>
          {/* Add Source Form */}
          <div style={{ background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #e5e7eb)', padding: 18, borderRadius: 8, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>+ Thêm Shop Nguồn để Giám sát & Cào</h3>
            <form onSubmit={handleAddSource}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={!isBulkSource} onChange={() => setIsBulkSource(false)} />
                    Nhập 1 shop
                  </label>
                  <label style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={isBulkSource} onChange={() => setIsBulkSource(true)} />
                    Dán nhiều shop cùng lúc (Bulk Paste)
                  </label>
                </div>

                {!isBulkSource ? (
                  <input
                    type="text"
                    placeholder="ví dụ: overtimegearz.shop hoặc https://overtimegearz.shop"
                    value={newSourceDomain}
                    onChange={(e) => setNewSourceDomain(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 14 }}
                  />
                ) : (
                  <textarea
                    rows={4}
                    placeholder="Dán danh sách các domain (mỗi dòng 1 domain hoặc cách nhau bởi dấu phẩy):&#10;overtimegearz.shop&#10;shop-a.myshopify.com&#10;https://shop-b.com"
                    value={newSourceDomain}
                    onChange={(e) => setNewSourceDomain(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13, fontFamily: 'monospace' }}
                  />
                )}
              </div>

              <button
                type="submit"
                style={{ padding: '9px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
              >
                {isBulkSource ? 'Thêm toàn bộ danh sách shop' : 'Thêm Shop Nguồn'}
              </button>
            </form>
          </div>

          {/* Sources Table */}
          <div style={{ overflowX: 'auto', background: 'var(--card-bg, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--table-head, #f9fafb)', borderBottom: '1px solid var(--border, #e5e7eb)', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 14px' }}>Tên & Domain</th>
                  <th style={{ padding: '10px 14px' }}>Trạng thái</th>
                  <th style={{ padding: '10px 14px' }}>Cron Tự Động</th>
                  <th style={{ padding: '10px 14px' }}>Tổng SP Đã Cào</th>
                  <th style={{ padding: '10px 14px' }}>Lần quét cuối & Log</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {sources.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                      Chưa có shop nguồn nào được thiết lập.
                    </td>
                  </tr>
                ) : (
                  sources.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
                        <a href={`https://${s.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'none' }}>
                          {s.domain} ↗
                        </a>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            background: s.status === 'active' ? '#dcfce7' : '#fee2e2',
                            color: s.status === 'active' ? '#166534' : '#991b1b',
                          }}
                        >
                          {s.status === 'active' ? '● Hoạt động' : '● Lỗi/Bị chặn'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={s.cronEnabled}
                            onChange={() => handleToggleCron(s.id, s.cronEnabled)}
                          />
                          <span style={{ fontSize: 12, color: s.cronEnabled ? '#16a34a' : 'var(--muted)' }}>
                            {s.cronEnabled ? 'Bật (Mỗi 15p)' : 'Tắt'}
                          </span>
                        </label>
                      </td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#4338ca' }}>
                        {s.productCount} sản phẩm
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: 260 }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {s.lastScrapedAt ? new Date(s.lastScrapedAt).toLocaleString('vi-VN') : 'Chưa quét'}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.lastStatusMessage || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleScanSource(s.id)}
                          disabled={scanningSourceId === s.id}
                          style={{
                            padding: '6px 12px',
                            fontSize: 12,
                            background: '#16a34a',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            cursor: scanningSourceId === s.id ? 'not-allowed' : 'pointer',
                            marginRight: 8,
                            fontWeight: 600,
                          }}
                        >
                          {scanningSourceId === s.id ? 'Đang cào...' : '⚡ Quét ngay'}
                        </button>
                        <button
                          onClick={() => handleDeleteSource(s.id)}
                          style={{ padding: '6px 10px', fontSize: 12, background: 'none', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Xoá
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: CỬA HÀNG ĐÍCH (TARGET STORES) */}
      {/* ==================================================================== */}
      {subTab === 'targets' && (
        <div>
          {/* Add Target Form */}
          <div style={{ background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #e5e7eb)', padding: 18, borderRadius: 8, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>+ Thêm Shop Đích của Tony</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted)' }}>
              Cung cấp thông tin kết nối Shopify Admin API. Lấy <b>Admin API Access Token</b> (bắt đầu bằng <code>shpat_...</code>) trong <i>Shopify Admin ➔ Settings ➔ Apps and sales channels ➔ Develop apps</i>.
            </p>
            <form onSubmit={handleAddTarget}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Tên gọi gợi nhớ:</label>
                  <input
                    type="text"
                    placeholder="ví dụ: Shop US Chính, Vệ tinh EU..."
                    value={newTargetName}
                    onChange={(e) => setNewTargetName(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Shopify Domain (bắt buộc):</label>
                  <input
                    type="text"
                    placeholder="ví dụ: my-brand.myshopify.com"
                    value={newTargetDomain}
                    onChange={(e) => setNewTargetDomain(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Admin Access Token (shpat_...):</label>
                  <input
                    type="password"
                    placeholder="shpat_xxxxxxxxxxxx"
                    value={newTargetToken}
                    onChange={(e) => setNewTargetToken(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  />
                </div>
              </div>

              <button
                type="submit"
                style={{ padding: '9px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
              >
                Lưu Shop Đích
              </button>
            </form>
          </div>

          {/* Targets Table */}
          <div style={{ overflowX: 'auto', background: 'var(--card-bg, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--table-head, #f9fafb)', borderBottom: '1px solid var(--border, #e5e7eb)', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 14px' }}>Tên Cửa Hàng</th>
                  <th style={{ padding: '10px 14px' }}>Shopify Domain</th>
                  <th style={{ padding: '10px 14px' }}>Token API</th>
                  <th style={{ padding: '10px 14px' }}>Trạng Thái & Kiểm tra</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                      Chưa có shop đích nào. Hãy thêm shop đích để hệ thống tự động đẩy hàng!
                    </td>
                  </tr>
                ) : (
                  targets.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 700 }}>{t.name}</td>
                      <td style={{ padding: '12px 14px', fontFamily: 'monospace' }}>{t.domain}</td>
                      <td style={{ padding: '12px 14px' }}>
                        {t.accessToken ? (
                          <span style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                            {t.accessToken.substring(0, 8)}••••••••
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>⚠️ Chưa có token</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => handleTestTarget(t.id)}
                            disabled={testingTargetId === t.id}
                            style={{
                              padding: '4px 10px',
                              fontSize: 11,
                              background: '#2563eb',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 4,
                              cursor: testingTargetId === t.id ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {testingTargetId === t.id ? 'Đang test...' : '🔌 Test kết nối'}
                          </button>
                          {testResult[t.id] && (
                            <span style={{ fontSize: 11 }}>{testResult[t.id]}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleDeleteTarget(t.id)}
                          style={{ padding: '6px 10px', fontSize: 12, background: 'none', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer' }}
                        >
                          Xoá
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: QUY TẮC & NHẬT KÝ CRON (RULES & LOGS) */}
      {/* ==================================================================== */}
      {subTab === 'rules' && (
        <div>
          {/* Rule Creator */}
          <div style={{ background: 'var(--card-bg, #fff)', border: '1px solid var(--border, #e5e7eb)', padding: 18, borderRadius: 8, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>⚙️ Thiết lập Quy tắc Tự động Đồng bộ (1-N hoặc N-1)</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted)' }}>
              Định tuyến tự động: Khi shop nguồn có sản phẩm mới, cron job sẽ tự động tính toán giá mới, thay thế vendor, lọc từ cấm và đẩy sang shop đích tương ứng.
            </p>

            <form onSubmit={handleSaveRule}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Shop Nguồn (Đối thủ):</label>
                  <select
                    value={ruleSourceId}
                    onChange={(e) => setRuleSourceId(Number(e.target.value))}
                    required
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  >
                    <option value={0}>-- Chọn shop nguồn --</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>{s.name || s.domain}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Shop Đích của Tony:</label>
                  <select
                    value={ruleTargetId}
                    onChange={(e) => setRuleTargetId(Number(e.target.value))}
                    required
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  >
                    <option value={0}>-- Chọn shop đích --</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>{t.name} ({t.domain})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Hệ số nhân giá (Multiplier):</label>
                  <input
                    type="number"
                    step="0.05"
                    value={rulePriceMult}
                    onChange={(e) => setRulePriceMult(e.target.value)}
                    placeholder="ví dụ 1.25 (+25%)"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Cộng thêm tiền ($):</label>
                  <input
                    type="number"
                    step="1"
                    value={rulePriceAdd}
                    onChange={(e) => setRulePriceAdd(e.target.value)}
                    placeholder="ví dụ 5"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Làm tròn đuôi giá:</label>
                  <select
                    value={ruleRounding}
                    onChange={(e) => setRuleRounding(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  >
                    <option value="none">Giữ nguyên số tính được</option>
                    <option value="99">Làm tròn đuôi .99 (VD: $59.99)</option>
                    <option value="95">Làm tròn đuôi .95 (VD: $59.95)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Đổi Vendor thành:</label>
                  <input
                    type="text"
                    placeholder="ví dụ: Tony Gear Store"
                    value={ruleVendor}
                    onChange={(e) => setRuleVendor(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Xoá từ cấm / Brand đối thủ:</label>
                  <input
                    type="text"
                    placeholder="cách nhau dấu phẩy: Overtime Gearz, Jen Custom Made"
                    value={ruleRemoveWords}
                    onChange={(e) => setRuleRemoveWords(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Trạng thái SP đăng lên:</label>
                  <select
                    value={ruleStatus}
                    onChange={(e) => setRuleStatus(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #d1d5db)', fontSize: 13 }}
                  >
                    <option value="active">Active (Lên kệ bán ngay)</option>
                    <option value="draft">Draft (Bản nháp để duyệt trước)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                style={{ padding: '9px 20px', background: '#9333ea', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
              >
                💾 Lưu Quy Tắc Đồng Bộ
              </button>
            </form>
          </div>

          {/* Active Rules List */}
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>Danh sách quy tắc đang kích hoạt:</h4>
            {rules.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Chưa có quy tắc nào.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
                {rules.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      background: 'var(--card-bg, #fff)',
                      border: '1px solid var(--border, #e5e7eb)',
                      borderRadius: 8,
                      padding: 14,
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#2563eb' }}>
                        {r.sourceStore?.domain} ➔ {r.targetStore?.name}
                      </span>
                      <button
                        onClick={() => handleDeleteRule(r.id)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                      • <b>Giá:</b> x{r.priceMultiplier} + ${r.priceAddition} ({r.priceRounding !== 'none' ? `đuôi .${r.priceRounding}` : 'chuẩn'})<br />
                      • <b>Vendor:</b> {r.overrideVendor || 'Giữ nguyên gốc'}<br />
                      • <b>Xoá từ:</b> {r.removeWords || 'Không'}<br />
                      • <b>Trạng thái:</b> {r.productStatus}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Logs Table */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>📋 Nhật ký đồng bộ gần nhất:</h4>
              <button onClick={fetchLogs} style={{ padding: '4px 10px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #d1d5db)', background: 'none', cursor: 'pointer' }}>
                Làm mới log
              </button>
            </div>
            <div style={{ overflowX: 'auto', background: 'var(--card-bg, #fff)', borderRadius: 8, border: '1px solid var(--border, #e5e7eb)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'var(--table-head, #f9fafb)', borderBottom: '1px solid var(--border, #e5e7eb)', color: 'var(--muted)' }}>
                    <th style={{ padding: '8px 12px' }}>Thời gian</th>
                    <th style={{ padding: '8px 12px' }}>Tên Sản Phẩm</th>
                    <th style={{ padding: '8px 12px' }}>Luồng Nguồn ➔ Đích</th>
                    <th style={{ padding: '8px 12px' }}>Kết quả</th>
                    <th style={{ padding: '8px 12px' }}>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Chưa có log đồng bộ nào.</td>
                    </tr>
                  ) : (
                    logs.map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                          {new Date(l.syncedAt).toLocaleString('vi-VN')}
                        </td>
                        <td style={{ padding: '8px 12px', maxWidth: 280, fontWeight: 600 }}>
                          {l.syncProduct?.title || 'Untitled'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ color: '#0369a1' }}>{l.syncProduct?.sourceStore?.domain}</span> ➔ <span style={{ color: '#15803d', fontWeight: 600 }}>{l.targetStore?.name}</span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontWeight: 600,
                              fontSize: 11,
                              background: l.status === 'success' ? '#dcfce7' : '#fee2e2',
                              color: l.status === 'success' ? '#15803d' : '#b91c1c',
                            }}
                          >
                            {l.status === 'success' ? 'Thành công' : 'Thất bại'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 11 }}>
                          {l.status === 'success' ? (
                            <span style={{ color: 'var(--muted)' }}>Shopify ID: {l.targetProductId}</span>
                          ) : (
                            <span style={{ color: '#ef4444' }}>{l.errorMessage}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* SUBTAB 5: THEME & STOREFRONT CLONER */}
      {/* ==================================================================== */}
      {subTab === 'theme' && (
        <ThemeClonerPanel targets={targets} />
      )}

      {/* ==================================================================== */}
      {/* MODAL: PREVIEW PRODUCT DETAILS */}
      {/* ==================================================================== */}
      {previewProduct && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setPreviewProduct(null)}
        >
          <div
            style={{
              background: 'var(--card-bg, #fff)',
              borderRadius: 10,
              maxWidth: 760,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <span style={{ fontSize: 12, color: '#2563eb', fontWeight: 600 }}>Nguồn: {previewProduct.sourceStore?.domain}</span>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0' }}>{previewProduct.title}</h2>
              </div>
              <button
                onClick={() => setPreviewProduct(null)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            {/* Images gallery */}
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 8 }}>
              {(() => {
                try {
                  const imgs = JSON.parse(previewProduct.imagesRaw || '[]');
                  return imgs.map((im: any, idx: number) => (
                    <img
                      key={idx}
                      src={im.src}
                      alt=""
                      style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb' }}
                    />
                  ));
                } catch {
                  return null;
                }
              })()}
            </div>

            {/* Variants table */}
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Danh sách biến thể ({(() => { try { return JSON.parse(previewProduct.variantsRaw || '[]').length; } catch { return 0; } })()}):</h4>
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '6px 10px' }}>Tên Variant</th>
                      <th style={{ padding: '6px 10px' }}>SKU</th>
                      <th style={{ padding: '6px 10px' }}>Giá Gốc</th>
                      <th style={{ padding: '6px 10px' }}>Giá So Sánh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      try {
                        const vars = JSON.parse(previewProduct.variantsRaw || '[]');
                        return vars.map((v: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '6px 10px', fontWeight: 600 }}>{v.title}</td>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{v.sku || '—'}</td>
                            <td style={{ padding: '6px 10px', color: '#16a34a', fontWeight: 600 }}>${v.price}</td>
                            <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{v.compare_at_price ? `$${v.compare_at_price}` : '—'}</td>
                          </tr>
                        ));
                      } catch {
                        return null;
                      }
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Description Preview */}
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Mô tả chi tiết (HTML):</h4>
              <div
                style={{
                  maxHeight: 200,
                  overflowY: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  padding: 12,
                  fontSize: 12,
                  background: '#f9fafb',
                }}
                dangerouslySetInnerHTML={{ __html: previewProduct.bodyHtml || '<i>Không có mô tả</i>' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: PUSH PRODUCTS TO TARGETS */}
      {/* ==================================================================== */}
      {pushModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => { if (!isPushing) setPushModalOpen(false); }}
        >
          <div
            style={{
              background: 'var(--card-bg, #fff)',
              borderRadius: 10,
              maxWidth: 520,
              width: '100%',
              padding: 24,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                🚀 Đồng bộ {selectedProductIds.length} sản phẩm lên Shop Đích
              </h3>
              {!isPushing && (
                <button
                  onClick={() => setPushModalOpen(false)}
                  style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', fontWeight: 700 }}
                >
                  ✕
                </button>
              )}
            </div>

            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
              Chọn các cửa hàng Shopify đích của bạn để đẩy sản phẩm sang:
            </p>

            {targets.length === 0 ? (
              <div style={{ padding: 14, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
                ⚠️ Bạn chưa cấu hình Shop Đích nào. Hãy vào tab <b>Shop Đích của bạn</b> để thêm shop kèm Access Token trước!
              </div>
            ) : (
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 16 }}>
                {targets.map((t) => (
                  <label
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 6px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pushTargetIds.includes(t.id)}
                      onChange={(e) => {
                        if (e.target.checked) setPushTargetIds((prev) => [...prev, t.id]);
                        else setPushTargetIds((prev) => prev.filter((id) => id !== t.id));
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t.domain}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {pushResultMsg && (
              <div style={{ padding: 10, background: '#f3f4f6', borderRadius: 6, fontSize: 12, marginBottom: 14 }}>
                {pushResultMsg}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                disabled={isPushing}
                onClick={() => setPushModalOpen(false)}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #d1d5db', background: 'none', cursor: 'pointer', fontSize: 13 }}
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={isPushing || targets.length === 0 || pushTargetIds.length === 0}
                onClick={handleExecutePush}
                style={{
                  padding: '8px 20px',
                  borderRadius: 6,
                  background: isPushing ? '#9ca3af' : '#16a34a',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: isPushing ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                }}
              >
                {isPushing ? 'Đang đẩy...' : 'Bắt đầu Đồng Bộ Ngay'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
