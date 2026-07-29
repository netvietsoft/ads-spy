'use client';
import { useEffect, useState } from 'react';
import { adminModules, adminSaveModule, adminDeleteModule, adminPlans, adminCreatePlan, adminUpdatePlan, adminDeletePlan } from '../api';

const dollars = (cents?: number) => ((cents || 0) / 100).toFixed(2);
function parseJson(s: string): { ok: true; v: any } | { ok: false } {
  try { return { ok: true, v: s.trim() ? JSON.parse(s) : {} }; } catch { return { ok: false }; }
}

export function PlansAdminPanel() {
  const [modules, setModules] = useState<any[]>([]);
  const [moduleKey, setModuleKey] = useState('');
  const [plans, setPlans] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [planEdit, setPlanEdit] = useState<any>(null);
  const [modEdit, setModEdit] = useState<any>(null);

  const loadModules = async () => { try { setModules(await adminModules()); } catch (e: any) { setErr(e.message); } };
  const loadPlans = async (mk?: string) => { try { setPlans(await adminPlans(mk || undefined)); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { loadModules(); loadPlans(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const newPlan = () => setPlanEdit({ moduleKey: moduleKey || modules[0]?.key || '', tier: 'basic', name: '', priceMonthlyUsd: '0', priceYearlyUsd: '0', currency: 'USD', features: '{}', quotas: '{}', stripePriceMonthly: '', stripePriceYearly: '' });
  const editPlan = (p: any) => setPlanEdit({ id: p.id, moduleKey: p.moduleKey, tier: p.tier, name: p.name, priceMonthlyUsd: dollars(p.priceMonthly), priceYearlyUsd: dollars(p.priceYearly), currency: p.currency, features: p.features || '{}', quotas: p.quotas || '{}', stripePriceMonthly: p.stripePriceMonthly || '', stripePriceYearly: p.stripePriceYearly || '' });
  const savePlan = async () => {
    setErr('');
    const f = parseJson(planEdit.features); const q = parseJson(planEdit.quotas);
    if (!f.ok) { setErr('features JSON không hợp lệ'); return; }
    if (!q.ok) { setErr('quotas JSON không hợp lệ'); return; }
    const body = { moduleKey: planEdit.moduleKey, tier: planEdit.tier, name: planEdit.name, priceMonthly: Math.round(Number(planEdit.priceMonthlyUsd || 0) * 100), priceYearly: Math.round(Number(planEdit.priceYearlyUsd || 0) * 100), currency: planEdit.currency || 'USD', features: f.v, quotas: q.v, stripePriceMonthly: planEdit.stripePriceMonthly || null, stripePriceYearly: planEdit.stripePriceYearly || null };
    try { if (planEdit.id) await adminUpdatePlan(planEdit.id, body); else await adminCreatePlan(body); setPlanEdit(null); loadPlans(moduleKey); } catch (e: any) { setErr(e.message); }
  };
  const delPlan = async (id: number) => { if (!confirm('Xóa plan này?')) return; try { await adminDeletePlan(id); loadPlans(moduleKey); } catch (e: any) { setErr(e.message); } };

  const newModule = () => setModEdit({ key: '', name: '', isFree: false, freeRecordCap: '', freeFeatures: '', _new: true });
  const editModule = (m: any) => setModEdit({ key: m.key, name: m.name, isFree: !!m.isFree, freeRecordCap: m.freeRecordCap ?? '', freeFeatures: m.freeFeatures || '', _new: false });
  const saveModule = async () => {
    setErr('');
    const body: any = { key: modEdit.key, name: modEdit.name, isFree: !!modEdit.isFree, freeRecordCap: modEdit.freeRecordCap !== '' ? Number(modEdit.freeRecordCap) : null };
    if (modEdit.freeFeatures?.trim()) { const ff = parseJson(modEdit.freeFeatures); if (!ff.ok) { setErr('freeFeatures JSON không hợp lệ'); return; } body.freeFeatures = ff.v; }
    try { await adminSaveModule(body, modEdit._new ? undefined : modEdit.key); setModEdit(null); loadModules(); } catch (e: any) { setErr(e.message); }
  };

  const inp = { padding: '7px 9px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14 } as const;
  return (
    <div>
      <h2 style={{ margin: '10px 0' }}>Gói &amp; Module</h2>
      {err && <div className="error">{err}</div>}

      <h3>Modules <button className="ghost" onClick={newModule}>+ Thêm module</button></h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="localtbl" style={{ width: '100%' }}>
          <thead><tr><th>Key</th><th>Tên</th><th>Free?</th><th>freeRecordCap</th><th></th></tr></thead>
          <tbody>{modules.map((m) => (
            <tr key={m.key}><td>{m.key}</td><td>{m.name}</td><td>{m.isFree ? '✓' : ''}</td><td>{m.freeRecordCap ?? ''}</td>
              <td><button className="ghost" onClick={() => editModule(m)}>Sửa</button> <button className="ghost" onClick={async () => { if (confirm('Xóa module?')) { try { await adminDeleteModule(m.key); loadModules(); } catch (e: any) { setErr(e.message); } } }}>Xóa</button></td></tr>
          ))}</tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 18 }}>Plans
        <select value={moduleKey} onChange={(e) => { setModuleKey(e.target.value); loadPlans(e.target.value); }} style={{ ...inp, marginLeft: 8 }}>
          <option value="">— tất cả module —</option>
          {modules.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}
        </select>
        <button className="ghost" onClick={newPlan} style={{ marginLeft: 8 }}>+ Thêm plan</button>
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="localtbl" style={{ width: '100%' }}>
          <thead><tr><th>Module</th><th>Tier</th><th>Tên</th><th>Tháng $</th><th>Năm $</th><th>StripePrice</th><th>Active</th><th></th></tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.id}><td>{p.moduleKey}</td><td>{p.tier}</td><td>{p.name}</td><td>{dollars(p.priceMonthly)}</td><td>{dollars(p.priceYearly)}</td>
              <td>{p.stripePriceMonthly ? '✓m' : ''}{p.stripePriceYearly ? '✓y' : ''}</td><td>{p.active ? '✓' : ''}</td>
              <td><button className="ghost" onClick={() => editPlan(p)}>Sửa</button> <button className="ghost" onClick={() => delPlan(p.id)}>Xóa</button></td></tr>
          ))}</tbody>
        </table>
      </div>

      {modEdit && (
        <div className="modal-bg" style={mbg} onClick={() => setModEdit(null)}>
          <div style={mbox} onClick={(e) => e.stopPropagation()}>
            <b>{modEdit._new ? 'Thêm module' : 'Sửa module ' + modEdit.key}</b>
            <input style={inp} placeholder="key (vd shopee)" value={modEdit.key} disabled={!modEdit._new} onChange={(e) => setModEdit({ ...modEdit, key: e.target.value })} />
            <input style={inp} placeholder="Tên" value={modEdit.name} onChange={(e) => setModEdit({ ...modEdit, name: e.target.value })} />
            <label><input type="checkbox" checked={modEdit.isFree} onChange={(e) => setModEdit({ ...modEdit, isFree: e.target.checked })} /> Module free</label>
            <input style={inp} placeholder="freeRecordCap (vd 5, để trống = none)" value={modEdit.freeRecordCap} onChange={(e) => setModEdit({ ...modEdit, freeRecordCap: e.target.value })} />
            <textarea style={{ ...inp, fontFamily: 'monospace', minHeight: 60 }} placeholder='freeFeatures JSON, vd {"lookup":true}' value={modEdit.freeFeatures} onChange={(e) => setModEdit({ ...modEdit, freeFeatures: e.target.value })} />
            <div style={mact}><button className="ghost" onClick={() => setModEdit(null)}>Hủy</button><button className="primary" onClick={saveModule}>Lưu</button></div>
          </div>
        </div>
      )}
      {planEdit && (
        <div className="modal-bg" style={mbg} onClick={() => setPlanEdit(null)}>
          <div style={{ ...mbox, width: 420 }} onClick={(e) => e.stopPropagation()}>
            <b>{planEdit.id ? 'Sửa plan' : 'Thêm plan'}</b>
            <select style={inp} value={planEdit.moduleKey} onChange={(e) => setPlanEdit({ ...planEdit, moduleKey: e.target.value })}>{modules.map((m) => <option key={m.key} value={m.key}>{m.key}</option>)}</select>
            <input style={inp} placeholder="tier (basic/pro/premium)" value={planEdit.tier} onChange={(e) => setPlanEdit({ ...planEdit, tier: e.target.value })} />
            <input style={inp} placeholder="Tên hiển thị" value={planEdit.name} onChange={(e) => setPlanEdit({ ...planEdit, name: e.target.value })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...inp, flex: 1 }} placeholder="Giá tháng (USD)" value={planEdit.priceMonthlyUsd} onChange={(e) => setPlanEdit({ ...planEdit, priceMonthlyUsd: e.target.value })} />
              <input style={{ ...inp, flex: 1 }} placeholder="Giá năm (USD)" value={planEdit.priceYearlyUsd} onChange={(e) => setPlanEdit({ ...planEdit, priceYearlyUsd: e.target.value })} />
            </div>
            <textarea style={{ ...inp, fontFamily: 'monospace', minHeight: 56 }} placeholder='features JSON, vd {"reports":true,"ai":false}' value={planEdit.features} onChange={(e) => setPlanEdit({ ...planEdit, features: e.target.value })} />
            <textarea style={{ ...inp, fontFamily: 'monospace', minHeight: 56 }} placeholder='quotas JSON, vd {"exportShops":5000}' value={planEdit.quotas} onChange={(e) => setPlanEdit({ ...planEdit, quotas: e.target.value })} />
            <input style={inp} placeholder="Stripe Price ID tháng (price_...)" value={planEdit.stripePriceMonthly} onChange={(e) => setPlanEdit({ ...planEdit, stripePriceMonthly: e.target.value })} />
            <input style={inp} placeholder="Stripe Price ID năm" value={planEdit.stripePriceYearly} onChange={(e) => setPlanEdit({ ...planEdit, stripePriceYearly: e.target.value })} />
            <div style={mact}><button className="ghost" onClick={() => setPlanEdit(null)}>Hủy</button><button className="primary" onClick={savePlan}>Lưu</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
const mbg: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
const mbox: React.CSSProperties = { background: '#fff', padding: 20, borderRadius: 12, width: 340, display: 'flex', flexDirection: 'column', gap: 9, maxHeight: '90vh', overflowY: 'auto' };
const mact: React.CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 };
