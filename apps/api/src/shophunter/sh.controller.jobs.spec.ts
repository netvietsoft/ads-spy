import { BadRequestException } from '@nestjs/common';
import { ShController } from './sh.controller';

function ctrl(jobs: any) {
  return new ShController({} as any, {} as any, {} as any, jobs);
}

describe('ShController jobs endpoints', () => {
  it('GET sh/jobs → jobsSvc.getJobs()', async () => {
    const jobs = { getJobs: jest.fn(async () => [{ name: 'harvest' }]), toggle: jest.fn() };
    const c = ctrl(jobs);
    expect(await c.jobsList()).toEqual([{ name: 'harvest' }]);
    expect(jobs.getJobs).toHaveBeenCalled();
  });

  it('POST toggle name hợp lệ → jobsSvc.toggle(name, on)', async () => {
    const jobs = { getJobs: jest.fn(), toggle: jest.fn(async (n: string, on: boolean) => ({ name: n, enabled: on })) };
    const c = ctrl(jobs);
    const r = await c.toggleJob('enrich', true);
    expect(jobs.toggle).toHaveBeenCalledWith('enrich', true);
    expect(r).toEqual({ name: 'enrich', enabled: true });
  });

  it('POST toggle name sai → BadRequestException', () => {
    const c = ctrl({ getJobs: jest.fn(), toggle: jest.fn() });
    expect(() => c.toggleJob('bogus', true)).toThrow(BadRequestException);
  });

  it('POST run-now name hợp lệ → jobsSvc.runOnce(name)', async () => {
    const jobs = { getJobs: jest.fn(), toggle: jest.fn(), runOnce: jest.fn(async (n: string) => ({ started: true })) };
    const c = ctrl(jobs);
    const r = await c.runJobOnce('catalog');
    expect(jobs.runOnce).toHaveBeenCalledWith('catalog');
    expect(r).toEqual({ started: true });
  });

  it('POST run-now name sai → BadRequestException', () => {
    const c = ctrl({ getJobs: jest.fn(), toggle: jest.fn(), runOnce: jest.fn() });
    expect(() => c.runJobOnce('bogus')).toThrow(BadRequestException);
  });

  it('POST config name hợp lệ → jobsSvc.setJobCfg(name, body)', async () => {
    const jobs = { setJobCfg: jest.fn(async (n: string, c: any) => ({ ...c })) };
    const c = ctrl(jobs);
    const r = await c.setJobConfig('enrich', { batch: 100, paceMs: 500 });
    expect(jobs.setJobCfg).toHaveBeenCalledWith('enrich', { batch: 100, paceMs: 500 });
    expect(r).toEqual({ batch: 100, paceMs: 500 });
  });

  it('POST config name sai → BadRequestException', () => {
    const c = ctrl({ setJobCfg: jest.fn() });
    expect(() => c.setJobConfig('bogus', {})).toThrow(BadRequestException);
  });
});
