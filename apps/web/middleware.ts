import { NextRequest, NextResponse } from 'next/server';

// Gate thô: có cookie phiên → cho qua; không → về /login. Xác thực + phân quyền THẬT do BE guard.
const COOKIE = process.env.AUTH_COOKIE_NAME || 'gas_session';
const PUBLIC_PATHS = ['/login', '/reset-password'];
// TẠM KHÓA (tầng SaaS chưa xong — phát triển sau). Code các trang vẫn NGUYÊN, chỉ chặn truy cập ở đây.
// Bật lại: bỏ path khỏi 2 mảng dưới. Đồng bộ với UI ẩn ở TopNav/login/UsersAdminPanel + CTA /pricing trong panel khách.
const DISABLED_TO_LOGIN = ['/landing', '/register', '/pricing'];
const DISABLED_TO_ADMIN = ['/admin/plans', '/admin/dashboard']; // gói + doanh thu SaaS chưa xong

function redirectTo(req: NextRequest, path: string) {
  const url = req.nextUrl.clone();
  url.pathname = path;
  url.search = '';
  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/')) return NextResponse.next(); // /api/* proxy sang BE (BE tự guard)
  const hit = (p: string) => pathname === p || pathname.startsWith(p + '/');
  if (DISABLED_TO_LOGIN.some(hit)) return redirectTo(req, '/login'); // trang SaaS công khai tạm khóa
  if (DISABLED_TO_ADMIN.some(hit)) return redirectTo(req, '/admin/users'); // gói + doanh thu admin tạm khóa → Người dùng
  if (PUBLIC_PATHS.some(hit)) return NextResponse.next();
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = '/login'; // chưa đăng nhập → login (landing đã tạm khóa)
  url.search = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  // ⚠️ Danh sách đuôi file này PHẢI phủ mọi tài nguyên tĩnh trong `public/`, không chỉ ảnh/css/js.
  // Thiếu `json` đã gây lỗi thật (2026-08-07): `/sh-categories.json` (725KB, đọc bởi CategoryPicker,
  // LocalDbPanel, ShCategories) bị middleware gác như một TRANG → thiếu/hết cookie phiên là **307 về
  // /login**; mà `fetch` TỰ ĐI THEO redirect nên FE nhận về **trang HTML của /login** rồi gọi `.json()`
  // → "Unexpected token '<', "<!DOCTYPE "... is not valid JSON". Thông báo đó không hề nhắc tới auth
  // nên rất khó truy ngược — dấu hiệu thật nằm ở status **307** của chính request đó.
  // Thêm luôn txt/woff/woff2/map để không lặp lại với favicon manifest, font, source map.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|json|txt|woff|woff2|map)$).*)'],
};
