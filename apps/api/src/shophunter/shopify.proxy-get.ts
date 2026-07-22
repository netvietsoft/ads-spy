// GET https qua proxy HTTP CONNECT + TLS, xoay proxy ngẫu nhiên, follow redirect. Dùng cho catalog crawler
// in-process (Shopify chặn IP datacenter → phải qua proxy). Cùng logic đã kiểm chứng ở scripts/catalog-bulk-scan.js.
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';

export interface ProxyForGet { host: string; port: number; username?: string | null; password?: string | null }

export function makeProxiedGet(getProxies: () => ProxyForGet[]) {
  return function proxiedGet(url: string, headers: Record<string, string>, timeoutMs = 20000, redir = 4): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const proxies = getProxies();
      if (!proxies.length) { reject(Object.assign(new Error('EPROXY_EMPTY'), { code: 'EPROXY_EMPTY' })); return; }
      const px = proxies[Math.floor(Math.random() * proxies.length)];
      const u = new URL(url); const tp = u.port || '443';
      const auth = px.username ? 'Basic ' + Buffer.from(px.username + ':' + (px.password || '')).toString('base64') : undefined;
      const creq = http.request({
        host: px.host, port: px.port, method: 'CONNECT', path: `${u.hostname}:${tp}`,
        headers: { ...(auth ? { 'Proxy-Authorization': auth } : {}), Host: `${u.hostname}:${tp}` }, timeout: timeoutMs,
      });
      let done = false;
      const fail = (e: any) => { if (!done) { done = true; reject(Object.assign(e || new Error('proxy'), { code: e?.code || 'EPROXY' })); } };
      creq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) { socket.destroy(); return fail(new Error('proxy ' + res.statusCode)); }
        const ts = tls.connect({ socket, servername: u.hostname }, () => {
          const g = https.request({ method: 'GET', path: u.pathname + u.search, headers: { Host: u.hostname, ...headers }, createConnection: () => ts as any, timeout: timeoutMs }, (r) => {
            const loc = r.headers.location;
            if (loc && [301, 302, 307, 308].includes(r.statusCode || 0) && redir > 0) { r.resume(); ts.end(); done = true; resolve(proxiedGet(new URL(loc, url).toString(), headers, timeoutMs, redir - 1)); return; }
            const ch: Buffer[] = []; r.on('data', (c) => ch.push(c)); r.on('end', () => { if (!done) { done = true; ts.end(); resolve({ status: r.statusCode || 0, body: Buffer.concat(ch).toString('utf8') }); } });
          });
          g.on('timeout', () => g.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))); g.on('error', fail); g.end();
        });
        ts.on('error', fail);
      });
      creq.on('timeout', () => creq.destroy(Object.assign(new Error('proxy timeout'), { code: 'ETIMEDOUT' }))); creq.on('error', fail); creq.end();
    });
  };
}
