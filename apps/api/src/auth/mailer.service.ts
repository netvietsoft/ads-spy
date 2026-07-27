import { Injectable, Logger } from '@nestjs/common';
import { authConfig } from './auth.config';

export function buildResetLink(rawToken: string): string {
  return `${authConfig.appBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

@Injectable()
export class MailerService {
  private readonly log = new Logger('MailerService');

  async sendPasswordReset(email: string, rawToken: string): Promise<void> {
    const link = buildResetLink(rawToken);
    if (!authConfig.smtp.host) {
      this.log.warn(`[DEV] Link đặt lại mật khẩu cho ${email}: ${link}`);
      return;
    }
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: authConfig.smtp.host,
      port: authConfig.smtp.port,
      secure: authConfig.smtp.port === 465,
      auth: authConfig.smtp.user ? { user: authConfig.smtp.user, pass: authConfig.smtp.pass } : undefined,
    });
    await transport.sendMail({
      from: authConfig.smtp.from,
      to: email,
      subject: 'Đặt lại mật khẩu',
      text: `Nhấp vào liên kết để đặt lại mật khẩu:\n${link}\n\nLiên kết hết hạn sau ${authConfig.resetTtlMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
    });
  }
}
