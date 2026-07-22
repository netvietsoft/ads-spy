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
});
