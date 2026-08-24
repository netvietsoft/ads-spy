import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const cents = (d) => Math.round(d * 100);

const upsertModule = (m) => prisma.module.upsert({ where: { key: m.key }, update: m, create: m });
const upsertPlan = (p) => prisma.plan.upsert({ where: { moduleKey_tier: { moduleKey: p.moduleKey, tier: p.tier } }, update: p, create: p });

try {
  // shophunter MỞ FREE hoàn toàn cho user (như google/fb/tiktok) — 2026-08-24. Bỏ freemium cap 5 + gói trả phí.
  // (Plan basic/pro/premium bên dưới vẫn seed nhưng vô hiệu về mặt chặn: isFree=true → resolve trả 'free' full.)
  await upsertModule({ key: 'shophunter', name: 'ShopHunter (Shopify)', category: 'ecom', isFree: true, freeFeatures: null, freeRecordCap: null, sortOrder: 1 });
  await upsertModule({ key: 'google-ads', name: 'Google Ads Spy', category: 'ads', isFree: true, sortOrder: 2 });
  await upsertModule({ key: 'fb-ads', name: 'Facebook Ads Spy', category: 'ads', isFree: true, sortOrder: 3 });
  await upsertModule({ key: 'tiktok-ads', name: 'TikTok Ads Spy', category: 'ads', isFree: true, sortOrder: 4 });

  await upsertPlan({ moduleKey: 'shophunter', tier: 'basic', name: 'ShopHunter Basic', priceMonthly: cents(19), priceYearly: cents(199), currency: 'USD', features: JSON.stringify({ lookup: true, track: true, reports: false, ai: false }), quotas: JSON.stringify({ exportShops: 1000, exportProducts: 10000 }), sortOrder: 1 });
  await upsertPlan({ moduleKey: 'shophunter', tier: 'pro', name: 'ShopHunter Pro', priceMonthly: cents(29), priceYearly: cents(299), currency: 'USD', features: JSON.stringify({ lookup: true, track: true, reports: true, ai: false }), quotas: JSON.stringify({ exportShops: 5000, exportProducts: 20000 }), sortOrder: 2 });
  await upsertPlan({ moduleKey: 'shophunter', tier: 'premium', name: 'ShopHunter Premium', priceMonthly: cents(39), priceYearly: cents(399), currency: 'USD', features: JSON.stringify({ lookup: true, track: true, reports: true, ai: true }), quotas: JSON.stringify({ exportShops: 10000, exportProducts: 100000 }), sortOrder: 3 });

  console.log('Seed catalog xong: 4 module (shophunter + 3 ad free) + 3 plan ShopHunter.');
} finally {
  await prisma.$disconnect();
}
