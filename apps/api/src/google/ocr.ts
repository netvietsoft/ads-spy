import { spawn } from 'child_process';
import { extractDomainFromOcr } from './ocr-domain';

// Chạy Tesseract NATIVE để đọc chữ trong ảnh creative. Suy biến ÊM ở mọi lỗi (thiếu binary, timeout, ảnh
// hỏng) → trả '' chứ KHÔNG ném: OCR là tính năng phụ, tuyệt đối không được làm gãy luồng tra cứu.
//
// Cần cài trên VPS: `sudo apt-get install -y tesseract-ocr`. Chưa cài thì spawn ném ENOENT → ta nuốt, trả ''.
// Dùng stdin→stdout (`tesseract stdin stdout`) nên KHÔNG ghi file tạm. --psm 6 = coi ảnh là một khối chữ
// đều (hợp quảng cáo text). -l eng: quảng cáo hầu hết tiếng Anh; domain là ký tự latin nên đủ.
export function runTesseract(image: Buffer, timeoutMs = 6000): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (s: string) => { if (!done) { done = true; resolve(s); } };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('tesseract', ['stdin', 'stdout', '--psm', '6', '-l', 'eng'], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      return finish(''); // spawn đồng bộ ném (hiếm) → coi như không có OCR
    }
    const out: Buffer[] = [];
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* đã chết */ } finish(''); }, timeoutMs);
    proc.on('error', () => { clearTimeout(timer); finish(''); }); // ENOENT khi chưa cài tesseract
    proc.stdout?.on('data', (d: Buffer) => out.push(d));
    proc.on('close', (code) => { clearTimeout(timer); finish(code === 0 ? Buffer.concat(out).toString('utf8') : ''); });
    proc.stdin?.on('error', () => { /* EPIPE nếu proc chết trước khi ghi xong — đã xử ở 'error'/'close' */ });
    proc.stdin?.end(image);
  });
}

// Đọc domain đích + text từ 1 ảnh. Trả null nếu OCR rỗng hoặc không tìm được domain (không bịa).
export async function ocrImageToDomain(image: Buffer, timeoutMs = 6000): Promise<{ domain: string | null; text: string } | null> {
  const text = (await runTesseract(image, timeoutMs)).trim();
  if (!text) return null;
  return { domain: extractDomainFromOcr(text), text: text.slice(0, 2000) };
}
