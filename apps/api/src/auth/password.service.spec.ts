import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();
  it('hash rồi verify đúng', async () => {
    const h = await svc.hash('secret123');
    expect(h).not.toBe('secret123');
    expect(await svc.verify('secret123', h)).toBe(true);
  });
  it('verify sai mật khẩu → false', async () => {
    const h = await svc.hash('secret123');
    expect(await svc.verify('wrong', h)).toBe(false);
  });
});
