module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',

  // 3 tuỳ chọn dưới đây thêm 2026-08-06 sau khi ĐO nguyên nhân 12 suite fail (63 test) của `npx jest`:
  // không suite nào sai logic — cả 12 đều là tranh chấp hạ tầng test. Xem docs/handoff-2026-08-05-*.md mục 5.

  // Nhiều spec dùng MySQL THẬT và KHÔNG đóng pool ở afterAll → jest chạy xong test rồi TREO vô hạn
  // (không in cả kết quả). Đây là lý do một lượt `jest --runInBand` từng phải kill sau 600s mà không có
  // output nào. forceExit cho jest thoát sau khi test xong. Đúng hơn là đi đóng pool ở từng spec —
  // nhưng đó là ~10 file, và mở pool trong test là cố ý (test chạy trên DB thật).
  forceExit: true,

  // Mỗi `new ShMysql()` mở pool riêng (connectionLimit 25) và các pool này TÍCH LUỸ trong process worker
  // vì spec không đóng pool; cộng thêm ~55 kết nối do dev server :3100 và app khác đang giữ (max_connections
  // 151). Chạy song song còn làm nhiều suite cùng gọi ensureReady (CREATE TABLE/ALTER) → metadata lock
  // trên cùng bảng. ĐO THẬT trên máy này, CÙNG một commit:
  //   nhiều worker (mặc định) → 12 suite fail / 63 test fail — 129,6s
  //   maxWorkers 2            →  1 suite fail /  5 test fail —  68,8s
  //   maxWorkers 1            →  82/82 suite · 642/642 test XANH —  65,2s
  // Tuần tự vừa XANH vừa NHANH HƠN: song song trên DB thật chỉ tạo tranh chấp rồi phải chạy lại.
  maxWorkers: 1,

  // Mặc định 5000ms là quá ngắn cho suite chạy trên DB thật: sh_product_list có 5,3M dòng / 4GB nên
  // COUNT/ensureReady tính bằng giây (đo: coverage 7,9s · catalog 5,8s · schema 3,6s · ensureTables 6,1s).
  // KHÔNG nới assertion nào — chỉ thừa nhận độ trễ thật của DB thay vì để test đỏ ngẫu nhiên.
  testTimeout: 30000,
};
