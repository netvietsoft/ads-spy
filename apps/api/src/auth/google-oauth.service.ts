import { Injectable } from '@nestjs/common';
import { fetch } from 'undici';
import { authConfig } from './auth.config';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name?: string;
  picture?: string;
}

@Injectable()
export class GoogleOAuthService {
  buildAuthUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: authConfig.google.clientId,
      redirect_uri: authConfig.google.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: authConfig.google.clientId,
        client_secret: authConfig.google.clientSecret,
        redirect_uri: authConfig.google.callbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenRes.ok) throw new Error('Google token exchange thất bại');
    const tok: any = await tokenRes.json();
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    if (!infoRes.ok) throw new Error('Google userinfo thất bại');
    const info: any = await infoRes.json();
    return { googleId: info.sub, email: info.email, name: info.name, picture: info.picture };
  }
}
