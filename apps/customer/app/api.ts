async function j(r: Response, msg: string) {
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any)))?.message || msg);
  return r.json();
}
export async function me() {
  const r = await fetch('/api/auth/me');
  return r.ok ? await r.json() : null;
}
export async function login(email: string, password: string) {
  return j(await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }), 'Đăng nhập thất bại');
}
export async function register(email: string, password: string, name?: string) {
  return j(await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name }) }), 'Đăng ký thất bại');
}
export async function forgot(email: string) {
  return j(await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }), 'Lỗi');
}
export async function resetPassword(token: string, password: string) {
  return j(await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) }), 'Token không hợp lệ hoặc hết hạn');
}
export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
}
export async function plans() {
  return j(await fetch('/api/plans'), 'Không tải được bảng giá');
}
export async function modules() {
  return j(await fetch('/api/modules'), 'Không tải được modules');
}
