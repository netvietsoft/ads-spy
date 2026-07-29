// Auth + catalog helpers cho các trang khách (tách khỏi api.ts công cụ).
// Fetch tương đối /api/... (proxy same-origin, cookie gas_session tự gửi).
// Khi !ok: throw Error với message server nếu có, else message rỗng → trang tự fallback qua t().
async function j(r: Response) {
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any)))?.message || '');
  return r.json();
}
export async function me() {
  const r = await fetch('/api/auth/me');
  return r.ok ? await r.json() : null;
}
export async function login(email: string, password: string) {
  return j(await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
}
export async function register(email: string, password: string, name?: string) {
  return j(await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) }));
}
export async function forgot(email: string) {
  return j(await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }));
}
export async function resetPassword(token: string, password: string) {
  return j(await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) }));
}
export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
}
export async function plans() {
  return j(await fetch('/api/plans'));
}
export async function modules() {
  return j(await fetch('/api/modules'));
}
