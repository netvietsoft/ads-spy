import { ShMysql } from './sh.mysql';
import { SHOP_DERIVED_AUTO_ALTER_MAX_MB } from './sh.shop-derived';

// Sự cố 2026-08-12: một ALTER trên sh_shop (chép bảng 2,4 GB) đang chạy thì ads-spy-api restart.
// `CREATE TABLE IF NOT EXISTS sh_shop` ở đầu connect() phải chờ metadata lock → onModuleInit treo →
// Nest KHÔNG BAO GIỜ gọi app.listen() → toàn bộ API trả 000 suốt ~110 phút, kể cả /api/health và đăng
// nhập (Prisma/SQLite, chẳng liên quan MySQL). Các test dưới khoá đúng những gì đã sửa.
describe('ShMysql — khởi động không phụ thuộc MySQL', () => {
  const newMysql = () => new ShMysql({} as any);

  it('onModuleInit KHÔNG chờ kết nối xong — MySQL treo thì API vẫn phải listen', async () => {
    const m = newMysql();
    let batDau = false;
    (m as any).connect = () => { batDau = true; return new Promise<void>(() => { /* không bao giờ xong */ }); };

    await m.onModuleInit(); // treo ở đây = test timeout = đúng cái lỗi đã gây sự cố

    expect(batDau).toBe(true); // vẫn phải KHỞI ĐỘNG việc kết nối, chỉ là không chờ nó
  });

  it('onModuleInit nuốt lỗi kết nối, không làm sập tiến trình', async () => {
    const m = newMysql();
    (m as any).connect = () => Promise.reject(new Error('ER_ACCESS_DENIED_ERROR'));
    await expect(m.onModuleInit()).resolves.toBeUndefined();
  });

  it('nhiều lần gọi đồng thời chỉ mở MỘT kết nối', async () => {
    // Hệ quả của việc onModuleInit không await nữa: request có thể ập tới lúc đang kết nối.
    // Không gộp thì mỗi request mở thêm một pool và chạy lại toàn bộ DDL.
    const m = newMysql();
    let solan = 0;
    let xong!: () => void;
    (m as any).connect = () => { solan++; return new Promise<void>((res) => { xong = res; }); };

    const a = (m as any).ensureConnected();
    const b = (m as any).ensureConnected();
    expect(solan).toBe(1);

    xong();
    await Promise.all([a, b]);
  });

  it('kết nối lỗi thì lần sau thử lại (không kẹt vĩnh viễn ở promise hỏng)', async () => {
    const m = newMysql();
    let solan = 0;
    (m as any).connect = () => { solan++; return Promise.reject(new Error('tạm thời')); };

    await expect((m as any).ensureConnected()).rejects.toThrow('tạm thời');
    await expect((m as any).ensureConnected()).rejects.toThrow('tạm thời');
    expect(solan).toBe(2);
  });

  it('ngưỡng tự-ALTER phải nhỏ hơn kích thước bảng thật', () => {
    // Bảng dev đo được 1.073 MB, prod 2.402 MB. Ngưỡng mà bị nâng lên quá tay là mở lại đúng cái bẫy:
    // API tự chép vài GB lúc khởi động và chết cả tiếng.
    expect(SHOP_DERIVED_AUTO_ALTER_MAX_MB).toBeLessThan(1000);
    expect(SHOP_DERIVED_AUTO_ALTER_MAX_MB).toBeGreaterThan(0);
  });
});
