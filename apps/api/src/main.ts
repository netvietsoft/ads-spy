import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GoogleBlockedFilter } from './google/google-blocked.filter';
import { FbBlockedFilter } from './facebook/fb-blocked.filter';
import { TtBlockedFilter } from './tiktok/tt-blocked.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalFilters(new GoogleBlockedFilter(), new FbBlockedFilter(), new TtBlockedFilter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3100;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api`);
}
bootstrap();
