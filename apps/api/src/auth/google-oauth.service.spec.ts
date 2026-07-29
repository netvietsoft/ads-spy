jest.mock('undici', () => ({ fetch: jest.fn() }));
import { fetch } from 'undici';
import { GoogleOAuthService } from './google-oauth.service';

const mockFetch = fetch as unknown as jest.Mock;

describe('GoogleOAuthService', () => {
  const svc = new GoogleOAuthService();
  beforeEach(() => mockFetch.mockReset());

  it('buildAuthUrl chứa state + response_type=code', () => {
    const url = svc.buildAuthUrl('st8');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('state=st8');
    expect(url).toContain('response_type=code');
  });
  it('exchangeCode: đổi code → profile', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'AT' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: 'gid', email: 'g@x.com', name: 'G', picture: 'p' }) });
    expect(await svc.exchangeCode('code123')).toEqual({ googleId: 'gid', email: 'g@x.com', name: 'G', picture: 'p' });
  });
  it('exchangeCode: token lỗi → throw', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(svc.exchangeCode('bad')).rejects.toThrow();
  });
});
