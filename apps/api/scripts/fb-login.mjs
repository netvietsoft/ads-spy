// Đăng nhập Facebook 1 lần để lưu phiên vào .pw-profile (dùng cho scrape post + tương tác).
// Chạy:  npm --workspace @gas/api run fb:login    (PHẢI dừng API trước để không khoá profile)
// Cửa sổ Chromium sẽ mở → bạn đăng nhập tài khoản (nên dùng NICK PHỤ). Đăng nhập xong để yên,
// script tự phát hiện cookie c_user rồi lưu và đóng.
import { chromium } from 'playwright';
import path from 'path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ctx = await chromium.launchPersistentContext(path.resolve('.pw-profile'), {
  headless: false,
  userAgent: UA,
  locale: 'vi-VN',
  viewport: { width: 1280, height: 900 },
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const page = await ctx.newPage();
await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
console.log('\n>> Hãy ĐĂNG NHẬP Facebook trong cửa sổ vừa mở (dùng nick phụ). Đang chờ...\n');

let ok = false;
for (let i = 0; i < 150; i++) {
  const cookies = await ctx.cookies();
  if (cookies.some((c) => c.name === 'c_user')) {
    ok = true;
    break;
  }
  await sleep(2000);
}
if (ok) {
  console.log('✅ Đăng nhập thành công — đã lưu phiên vào .pw-profile. Đóng cửa sổ...');
  await sleep(2500);
} else {
  console.log('⏱️ Hết thời gian chờ (5 phút) mà chưa thấy đăng nhập. Chạy lại nếu cần.');
}
await ctx.close();
process.exit(ok ? 0 : 1);
