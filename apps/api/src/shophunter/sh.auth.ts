import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const TOKEN_KEY = 'shophunter_refresh_token';
const CLIENT_ID = '5smj62slr8j2ejqoja4uq0o40u';
const COGNITO_URL = 'https://cognito-idp.us-east-1.amazonaws.com/';

export function needsRefresh(expEpochSec: number, nowMs: number, skewSec = 300): boolean {
  return nowMs / 1000 > expEpochSec - skewSec;
}

function decodeJwt(jwt: string): { email?: string; name?: string; exp?: number } {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
  } catch {
    return {};
  }
}

export class ShAuthError extends Error {
  constructor(message = 'Chưa có ShopHunter refresh token. Vào tab ShopHunter dán token.') {
    super(message);
    this.name = 'ShAuthError';
  }
}

@Injectable()
export class ShAuth {
  private idToken: string | null = null;
  private expSec = 0;
  private email?: string;

  constructor(private readonly prisma: PrismaService) {}

  private async readRefreshToken(): Promise<string | null> {
    const s = await this.prisma.fbSetting.findUnique({ where: { key: TOKEN_KEY } }).catch(() => null);
    return s?.value || null;
  }

  private async mint(refreshToken: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(COGNITO_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: CLIENT_ID,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      });
    } catch (e) {
      throw new ShAuthError(`Không gọi được Cognito: ${(e as Error).message}`);
    }
    const j: any = await res.json().catch(() => ({}));
    const idToken = j?.AuthenticationResult?.IdToken;
    if (!idToken) {
      throw new ShAuthError(`Refresh token hỏng/hết hạn (${j?.__type || res.status}). Dán lại token.`);
    }
    const p = decodeJwt(idToken);
    this.idToken = idToken;
    this.expSec = p.exp || Math.floor(Date.now() / 1000) + 3600;
    this.email = p.email;
    return idToken;
  }

  async getToken(): Promise<string> {
    if (this.idToken && !needsRefresh(this.expSec, Date.now())) return this.idToken;
    const rt = await this.readRefreshToken();
    if (!rt) throw new ShAuthError();
    return this.mint(rt);
  }

  invalidate() {
    this.idToken = null;
    this.expSec = 0;
  }

  async setRefreshToken(token: string): Promise<{ valid: boolean; email?: string; expiresAt?: number }> {
    const clean = (token || '').trim();
    if (!clean) return { valid: false };
    // validate bằng cách mint thử; token hỏng → không lưu, trả về valid:false
    try {
      await this.mint(clean);
    } catch {
      return { valid: false };
    }
    await this.prisma.fbSetting
      .upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value: clean }, update: { value: clean } })
      .catch(() => undefined);
    return { valid: true, email: this.email, expiresAt: this.expSec * 1000 };
  }

  // Xóa refresh token đã lưu + quên id-token trong RAM → trạng thái "chưa kết nối" để dán token mới.
  async clearRefreshToken(): Promise<{ ok: true }> {
    await this.prisma.fbSetting.deleteMany({ where: { key: TOKEN_KEY } }).catch(() => undefined);
    this.idToken = null;
    this.expSec = 0;
    this.email = undefined;
    return { ok: true };
  }

  async status(): Promise<{ valid: boolean; email?: string; expiresAt?: number }> {
    const rt = await this.readRefreshToken();
    if (!rt) return { valid: false };
    try {
      await this.getToken();
      return { valid: true, email: this.email, expiresAt: this.expSec * 1000 };
    } catch {
      return { valid: false };
    }
  }
}
