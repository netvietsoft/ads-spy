import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ThemeAnalyzerService } from './theme-analyzer.service';
import { ThemePackagerService } from './theme-packager.service';
import { ThemeDeployerService } from './theme-deployer.service';
import { ThemeClonerController } from './theme-cloner.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ThemeClonerController],
  providers: [ThemeAnalyzerService, ThemePackagerService, ThemeDeployerService],
  exports: [ThemeAnalyzerService, ThemePackagerService, ThemeDeployerService],
})
export class ThemeClonerModule {}
