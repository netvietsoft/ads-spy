import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const email = (process.env.SEED_ADMIN_EMAIL || process.argv[2] || '').toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD || process.argv[3] || '';
if (!email || !password) {
  console.error('Cần SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD, hoặc: node scripts/create-admin.mjs <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Mật khẩu tối thiểu 8 ký tự.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', passwordHash, status: 'active' },
    create: { email, passwordHash, role: 'admin', name: 'Admin' },
  });
  console.log(`Admin sẵn sàng: ${user.email} (id=${user.id}, role=${user.role})`);
} finally {
  await prisma.$disconnect();
}
