import { buildResetLink, MailerService } from './mailer.service';
import { authConfig } from './auth.config';

describe('MailerService', () => {
  it('buildResetLink chứa base URL + token đã encode', () => {
    const link = buildResetLink('a b/c');
    expect(link.startsWith(authConfig.appBaseUrl + '/reset-password?token=')).toBe(true);
    expect(link).toContain(encodeURIComponent('a b/c'));
  });
  it('dev (không SMTP_HOST): chỉ log, không ném lỗi', async () => {
    // authConfig.smtp.host mặc định '' trong test → nhánh dev
    expect(authConfig.smtp.host).toBe('');
    await expect(new MailerService().sendPasswordReset('u@x.com', 'tok')).resolves.toBeUndefined();
  });
});
