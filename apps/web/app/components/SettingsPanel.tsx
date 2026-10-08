'use client';
import { useEffect, useRef, useState } from 'react';
import { ShJob, shJobs, shToggleJob, shRunJobOnce, shSetJobConfig } from '../api';
import { ProxyPanel } from './ProxyPanel';
import { ShTokenBox } from './ShTokenBox';
import { FbCookieBox } from './FbCookieBox';
import { AffnetTokenBox } from './AffnetTokenBox';

const STATUS_VI: Record<string, string> = { ok: 'OK', idle: 'Nghỉ (hết việc)', blocked: 'Bị chặn', no_proxy: 'Thiếu proxy', running: 'Đang chạy' };
const CFG_LABEL: Record<string, string> = {
  daily: 'Trần/ngày', perTick: 'Mỗi lượt (cron)', skipPct: 'Bỏ lượt %', delayMs: 'Nghỉ/shop (ms)',
  concurrency: 'Số luồng', batch: 'Số/lượt (batch)', paceMs: 'Nghỉ giữa lượt (ms)',
  staleDays: 'Cũ hơn (ngày)',
  activeStart: 'Giờ bắt đầu (0-24)', activeEnd: 'Giờ kết thúc (0-24)',
};
const fmtTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');

function JobTuner({ cfg, busy, onSave }: { cfg: Record<string, number>; busy: boolean; onSave: (c: Record<string, number>) => void }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Record<string, number>>({ ...cfg });
  return (
    <div className="jobtuner-wrap">
      <button type="button" className="srcbtn jobtuner-btn" onClick={() => { setEdit({ ...cfg }); setOpen((o) => !o); }}>
        {open ? '▾' : '▸'} Tốc độ
      </button>
      {open && (
        <div className="jobtuner">
          {Object.keys(cfg).map((k) => (
            <label key={k} className="jobtuner-f">
              <span>{CFG_LABEL[k] || k}</span>
              <input type="number" value={edit[k] ?? 0}
                onChange={(e) => setEdit((s) => ({ ...s, [k]: Number(e.target.value) }))} />
            </label>
          ))}
          <button type="button" className="srcbtn active jobtuner-save" disabled={busy} onClick={() => onSave(edit)}>{busy ? '…' : 'Lưu'}</button>
          <span className="jobtuner-hint">Càng mạnh (batch/luồng ↑, nghỉ ↓) càng nhanh nhưng dễ bị chặn.</span>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, busyToggle, busyRun, busyCfg, onToggle, onRunNow, onSaveCfg }:
  { job: ShJob; busyToggle: boolean; busyRun: boolean; busyCfg: boolean; onToggle: (on: boolean) => void; onRunNow: () => void; onSaveCfg: (c: Record<string, number>) => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [job.logs]);
  const badge = job.running
    ? <span className="jobbadge run">● Đang chạy</span>
    : job.enabled ? <span className="jobbadge">Bật (chờ)</span> : <span className="jobbadge off">Tắt</span>;
  const statsStr = Object.entries(job.stats || {}).map(([k, v]) => `${k}=${v}`).join(' · ');
  return (
    <div className="jobcard">
      <div className="jobhead">
        <div>
          <div className="jobtitle">{job.name}</div>
          <div className="jobdesc">{job.desc}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {badge}
          <button className="srcbtn" disabled={busyRun} onClick={onRunNow} title="Chạy 1 lượt ngay (bỏ qua lịch cron) — xem kết quả ở log">
            {busyRun ? '…' : 'Chạy ngay'}
          </button>
          <button className={`srcbtn ${job.enabled ? 'active' : ''}`} disabled={busyToggle} onClick={() => onToggle(!job.enabled)}>
            {busyToggle ? '…' : job.enabled ? 'Tắt' : 'Bật'}
          </button>
        </div>
      </div>
      <div className="jobmeta">
        Lượt gần nhất: {fmtTime(job.lastRunAt)} · Trạng thái: {STATUS_VI[job.lastStatus || ''] || job.lastStatus || '—'}
        {statsStr && ' · ' + statsStr}
      </div>
      <JobTuner cfg={job.cfg || {}} busy={busyCfg} onSave={onSaveCfg} />
      <div className="joblog" ref={logRef}>
        {job.logs.length
          ? job.logs.map((l, i) => (
            <div key={i}>[{new Date(l.ts).toLocaleTimeString()}] {l.level !== 'info' ? `(${l.level}) ` : ''}{l.msg}</div>
          ))
          : <span style={{ opacity: 0.6 }}>Chưa có log.</span>}
      </div>
    </div>
  );
}

const JOB_GROUPS: { id: string; label: string; jobs?: string[] }[] = [
  { id: 'all', label: 'Tất cả job' },
  { id: 'bw', label: '⚡ Shopify BuiltWith (560k)', jobs: ['bwdns', 'bwtraffic', 'bwdetect', 'bwrev', 'bwterms'] },
  { id: 'aff', label: '🌐 Affiliate Nets & Library', jobs: ['affdiscover', 'afffetch', 'afflibrev', 'affterms'] },
  { id: 'sh', label: '🛒 ShopHunter & Catalog', jobs: ['harvest', 'enrich', 'catalog', 'productrev', 'affiliate', 'importenrich', 'refresh'] },
];

export function SettingsPanel() {
  const [jobs, setJobs] = useState<ShJob[]>([]);
  const [group, setGroup] = useState<string>('all');
  const [busy, setBusy] = useState(''); // '' | '<name>' (toggle) | '<name>:run' (chạy ngay)
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hash.replace(/^#/, '');
      if (h === 'bw' || h === 'shopify-bw' || h === 'builtwith') setGroup('bw');
      else if (h === 'aff' || h === 'affnet') setGroup('aff');
      else if (h === 'sh' || h === 'shophunter') setGroup('sh');
    }
  }, []);

  const reload = () => shJobs().then((j) => { setJobs(j); setErr(null); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { reload(); const t = setInterval(reload, 4000); return () => clearInterval(t); }, []);
  const toggle = async (name: string, on: boolean) => {
    setBusy(name);
    try { await shToggleJob(name, on); await reload(); } catch { /* ignore */ }
    setBusy('');
  };
  const runNow = async (name: string) => {
    setBusy(name + ':run');
    try { await shRunJobOnce(name); await reload(); } catch { /* ignore */ }
    setBusy('');
  };
  const saveCfg = async (name: string, cfg: Record<string, number>) => {
    setBusy(name + ':cfg');
    try { await shSetJobConfig(name, cfg); await reload(); } catch { /* ignore */ }
    setBusy('');
  };

  const currentGroupObj = JOB_GROUPS.find((g) => g.id === group);
  const visibleJobs = !currentGroupObj || currentGroupObj.id === 'all'
    ? jobs
    : jobs.filter((j) => currentGroupObj.jobs?.includes(j.name));

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}><ShTokenBox /></div>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}><FbCookieBox /></div>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}><AffnetTokenBox /></div>
      </div>
      <h3 style={{ margin: '18px 0 4px' }}>⚙️ Cài đặt — Job nền</h3>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Bật/tắt và theo dõi log các job. Toàn bộ tiến trình chạy ngầm trực tiếp trên backend daemon (tắt web máy tính dịch vụ vẫn tiếp tục chạy 24/7). Bấm <b>Chạy ngay</b> để kích hoạt 1 lượt liền.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '14px 0 16px', flexWrap: 'wrap' }}>
        {JOB_GROUPS.map((g) => (
          <button key={g.id} type="button"
            className={`srcbtn ${group === g.id ? 'active' : ''}`}
            onClick={() => setGroup(g.id)}
            style={{ fontWeight: group === g.id ? 700 : 500 }}>
            {g.label}
          </button>
        ))}
      </div>

      {err && jobs.length === 0 && (
        <div className="err">
          Không tải được danh sách job: {err}. Kiểm tra API (NEXT_PUBLIC_API_ORIGIN khi build web).{' '}
          <button className="srcbtn" onClick={reload}>Thử lại</button>
        </div>
      )}
      {visibleJobs.map((j) => (
        <JobCard key={j.name} job={j}
          busyToggle={busy === j.name} busyRun={busy === j.name + ':run'} busyCfg={busy === j.name + ':cfg'}
          onToggle={(on) => toggle(j.name, on)} onRunNow={() => runNow(j.name)} onSaveCfg={(c) => saveCfg(j.name, c)} />
      ))}
      <div style={{ marginTop: 24 }}>
        <ProxyPanel />
      </div>
    </div>
  );
}
