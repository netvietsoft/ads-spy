import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { GoogleBlockedFilter } from './google/google-blocked.filter';
import { FbBlockedFilter } from './facebook/fb-blocked.filter';
import { TtBlockedFilter } from './tiktok/tt-blocked.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Body lớn cho import (mặc định Express ~100kb → "request entity too large").
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalFilters(new GoogleBlockedFilter(), new FbBlockedFilter(), new TtBlockedFilter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3100;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap();
