import * as http from 'http';
import * as net from 'net';

export interface ProxyRow { type: string; host: string; port: number; username: string | null; password: string | null; raw: string; }

// Parse 1 dòng proxy → {type,host,port,user,pass} hoặc null nếu KHÔNG nhận dạng được (chỉ HTTP/SOCKS5 chuẩn).
// Nhận: `scheme://[user:pass@]host:port` (http/https/socks5) | `host:port:user:pass` | `host:port` (mặc định http).
// KHÔNG nhận: kiểu `server=...&secret=...` (Shadowsocks/MTProto — crawler HTTP-CONNECT không dùng được).
export function parseProxyLine(line: string): ProxyRow | null {
  const s = (line || '').trim();
  if (!s || s.startsWith('#')) return null;
  const m = s.match(/^(socks5?|https?):\/\/(?:([^:@]+):([^@]+)@)?([^:/@]+):(\d+)/i);
  if (m) {
    const type = m[1].toLowerCase().startsWith('socks') ? 'socks5' : 'http';
    return { type, host: m[4], port: Number(m[5]), username: m[2] || null, password: m[3] || null, raw: s };
  }
  const parts = s.split(':');
  if ((parts.length === 4 || parts.length === 2) && /^\d+$/.test(parts[1]) && parts[0]) {
    return { type: 'http', host: parts[0], port: Number(parts[1]), username: parts[2] || null, password: parts[3] || null, raw: s };
  }
  return null;
}

// Parse nhiều dòng → { ok: proxy hợp lệ, bad: dòng không nhận dạng }.
export function parseProxies(text: string): { ok: ProxyRow[]; bad: string[] } {
  const ok: ProxyRow[] = []; const bad: string[] = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const p = parseProxyLine(t);
    if (p) ok.push(p); else bad.push(t);
  }
  return { ok, bad };
}

// Test 1 proxy → {live, pingMs}. HTTP: CONNECT tới target HTTPS (chắc tunnel được). SOCKS5: TCP connect tới proxy (reachable).
export function testProxy(p: ProxyRow, timeoutMs = 12000): Promise<{ live: boolean; pingMs: number | null; error?: string }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const finish = (live: boolean, error?: string) => { if (!done) { done = true; resolve({ live, pingMs: live ? Date.now() - t0 : null, error }); } };
    if (p.type === 'socks5') {
      const sock = net.connect({ host: p.host, port: p.port, timeout: timeoutMs }, () => { sock.destroy(); finish(true); });
      sock.on('timeout', () => { sock.destroy(); finish(false, 'timeout'); });
      sock.on('error', (e) => finish(false, (e as Error).message));
      return;
    }
    const target = 'www.google.com:443';
    const headers: any = { Host: target };
    if (p.username) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${p.username}:${p.password || ''}`).toString('base64');
    const req = http.request({ host: p.host, port: p.port, method: 'CONNECT', path: target, headers, timeout: timeoutMs });
    req.on('connect', (res, socket) => { socket.destroy(); finish(res.statusCode === 200, res.statusCode === 200 ? undefined : 'HTTP ' + res.statusCode); });
    req.on('timeout', () => { req.destroy(); finish(false, 'timeout'); });
    req.on('error', (e) => finish(false, (e as Error).message));
    req.end();
  });
}
