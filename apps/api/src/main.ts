import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded, raw } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { GoogleBlockedFilter } from './google/google-blocked.filter';
import { FbBlockedFilter } from './facebook/fb-blocked.filter';
import { TtBlockedFilter } from './tiktok/tt-blocked.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Body lớn cho import (mặc định Express ~100kb → "request entity too large").
  app.use('/api/webhooks/stripe', raw({ type: '*/*' }));
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  // MẶC ĐỊNH: không cache response API. Đặt ở ĐÂY (không phải nginx/Cloudflare) vì 3 lý do:
  //  1. Đúng cho MỌI đường đi — /api/* qua rewrite của Next lẫn /backend-api/* qua nginx.
  //  2. Không phụ thuộc một Cache Rule trên dashboard Cloudflare, thứ có thể bị xoá hoặc thiếu ở môi
  //     trường mới. Origin tự tuyên bố thì mọi proxy đều phải tuân theo.
  //  3. Chặn ở nginx sẽ đè cả 2 endpoint proxy ẢNH đang CỐ Ý cache 1 giờ
  //     (sh.controller.ts `sh/asset`, search.controller.ts asset/embed) → mỗi lượt xem lại tải lại ảnh.
  // Vì sao cần: từ 2026-08-07 API nằm dưới một PATH của domain web nên DÙNG CHUNG chính sách cache với
  // website. Cloudflare đã cache trang HTML 404 của Next cho từng URL /backend-api/* và trả lại mãi —
  // FE parse HTML thành JSON → "Unexpected token '<', "<!DOCTYPE "". Nguy hơn nữa: khi endpoint trả JSON
  // thật, cùng cơ chế đó sẽ cache DỮ LIỆU CỦA NGƯỜI NÀY rồi phát cho người khác.
  // Đây chỉ là MẶC ĐỊNH: handler chạy SAU middleware nên `res.setHeader` trong handler vẫn thắng.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new GoogleBlockedFilter(), new FbBlockedFilter(), new TtBlockedFilter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3100;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap();
