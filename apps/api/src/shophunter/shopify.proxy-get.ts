// GET https qua proxy HTTP CONNECT + TLS, xoay proxy ngẫu nhiên, follow redirect. Dùng cho catalog crawler
// in-process (Shopify chặn IP datacenter → phải qua proxy). Hỗ trợ tự động xoay và thử lại qua proxy khác trong bể proxy.
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

export interface ProxyForGet { host: string; port: number; username?: string | null; password?: string | null }

function doSingleProxiedGet(
  px: ProxyForGet,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  redir: number,
  retryFn: (u: string) => Promise<{ status: number; body: string }>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch (e: any) {
      return reject(Object.assign(e || new Error('Invalid URL: ' + url), { code: 'EINVAL_URL' }));
    }
    const tp = u.port || '443';
    const auth = px.username ? 'Basic ' + Buffer.from(px.username + ':' + (px.password || '')).toString('base64') : undefined;
    const creq = http.request({
      host: px.host,
      port: px.port,
      method: 'CONNECT',
      path: `${u.hostname}:${tp}`,
      headers: { ...(auth ? { 'Proxy-Authorization': auth } : {}), Host: `${u.hostname}:${tp}` },
      timeout: timeoutMs,
    });
    let done = false;
    const fail = (e: any) => {
      if (!done) {
        done = true;
        reject(Object.assign(e || new Error('proxy'), { code: e?.code || 'EPROXY' }));
      }
    };
    creq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return fail(new Error('proxy ' + res.statusCode));
      }
      const ts = tls.connect({ socket, servername: u.hostname }, () => {
        const g = https.request(
          {
            method: 'GET',
            path: u.pathname + u.search,
            headers: { Host: u.hostname, ...headers },
            createConnection: () => ts as any,
            timeout: timeoutMs,
          },
          (r) => {
            const loc = r.headers.location;
            if (loc && [301, 302, 307, 308].includes(r.statusCode || 0) && redir > 0) {
              r.resume();
              ts.end();
              let nextUrl: string;
              try {
                nextUrl = new URL(loc, url).toString();
              } catch {
                if (!done) {
                  done = true;
                  resolve({ status: r.statusCode || 0, body: `Invalid redirect Location: ${loc}` });
                }
                return;
              }
              done = true;
              resolve(retryFn(nextUrl));
              return;
            }
            const ch: Buffer[] = [];
            r.on('data', (c) => ch.push(c));
            r.on('end', () => {
              if (!done) {
                done = true;
                ts.end();
                resolve({ status: r.statusCode || 0, body: Buffer.concat(ch).toString('utf8') });
              }
            });
          },
        );
        g.on('timeout', () => g.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
        g.on('error', fail);
        g.end();
      });
      ts.on('error', fail);
    });
    creq.on('timeout', () => creq.destroy(Object.assign(new Error('proxy timeout'), { code: 'ETIMEDOUT' })));
    creq.on('error', fail);
    creq.end();
  });
}

const CHALLENGE_RE = /just a moment\.\.\.|checking your browser before|cf-browser-verification|challenge-platform|__cf_chl|cf_chl_opt|attention required! \| cloudflare|enable javascript and cookies to continue|ddos protection by cloudflare/i;

export function makeProxiedGet(getProxies: () => ProxyForGet[], maxRetries = 2) {
  return async function proxiedGet(url: string, headers: Record<string, string>, timeoutMs = 12000, redir = 4): Promise<{ status: number; body: string }> {
    const proxies = getProxies();
    if (!proxies.length) {
      throw Object.assign(new Error('EPROXY_EMPTY'), { code: 'EPROXY_EMPTY' });
    }

    const pool = [...proxies].sort(() => Math.random() - 0.5);
    const attempts = Math.max(1, Math.min(maxRetries + 1, pool.length));
    let lastErr: any = null;
    let lastRes: { status: number; body: string } | null = null;

    for (let att = 0; att < attempts; att++) {
      const px = pool[att % pool.length];
      try {
        const res = await doSingleProxiedGet(px, url, headers, timeoutMs, redir, (nextUrl) => proxiedGet(nextUrl, headers, timeoutMs, redir - 1));
        // Nếu proxy này bị Shopify bóp IP (429) hoặc dính Cloudflare bot challenge, và còn proxy khác trong pool → thử proxy kế tiếp
        if ((res.status === 429 || CHALLENGE_RE.test(res.body)) && att < attempts - 1) {
          lastRes = res;
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        return res;
      } catch (err: any) {
        lastErr = err;
        if (att < attempts - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    }
    if (lastRes) return lastRes;
    throw lastErr;
  };
}

