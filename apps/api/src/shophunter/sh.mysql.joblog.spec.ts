// Chạy với MySQL local. Tự dọn rác bằng job name riêng; KHÔNG prune ts lớn (DB dùng chung nhiều spec).
import { ShMysql } from './sh.mysql';

describe('ShMysql.sh_job_log', () => {
  const JOB = 'test_joblog_spec';

  it('append → tail (cũ→mới) → prune chỉ dòng cũ', async () => {
    const m = new ShMysql({ fbSetting: { findUnique: async () => null } } as any);
    await (m as any).ensureReady();
    const pool = (m as any).pool;
    await pool.query('DELETE FROM sh_job_log WHERE job = ?', [JOB]);

    await m.appendJobLog(JOB, 'info', 'dòng 1');
    await m.appendJobLog(JOB, 'warn', 'dòng 2');
    await m.appendJobLog(JOB, 'info', 'dòng 3');

    const tail = await m.tailJobLog(JOB, 10);
    expect(tail.map((l) => l.msg)).toEqual(['dòng 1', 'dòng 2', 'dòng 3']); // cũ→mới
    expect(tail[1].level).toBe('warn');
    expect(typeof tail[0].ts).toBe('number');

    // Chèn 1 dòng "cũ" (ts=1000 = 1970) rồi prune(2000): chỉ dòng cũ bị xoá, 3 dòng mới (ts≈now) sống.
    await pool.query('INSERT INTO sh_job_log (job, ts, level, msg) VALUES (?, ?, ?, ?)', [JOB, 1000, 'info', 'cũ']);
    const deleted = await m.pruneJobLog(2000);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const tail2 = await m.tailJobLog(JOB, 10);
    expect(tail2.map((l) => l.msg)).toEqual(['dòng 1', 'dòng 2', 'dòng 3']);

    await pool.query('DELETE FROM sh_job_log WHERE job = ?', [JOB]);
  }, 30000);
});
