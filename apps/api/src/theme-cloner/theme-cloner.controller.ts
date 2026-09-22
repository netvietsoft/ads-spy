import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/roles.decorator';
import { ThemeAnalyzerService } from './theme-analyzer.service';
import { ThemePackagerService } from './theme-packager.service';
import { ThemeDeployerService } from './theme-deployer.service';
import {
  StorefrontBlueprint,
  ThemeDeployOptions,
} from './theme-cloner.types';

@Controller('theme-cloner')
export class ThemeClonerController {
  constructor(
    private readonly analyzerService: ThemeAnalyzerService,
    private readonly packagerService: ThemePackagerService,
    private readonly deployerService: ThemeDeployerService,
  ) {}

  @Public()
  @Post('analyze')
  async analyzeStorefront(@Body('domain') domain: string) {
    if (!domain) {
      throw new HttpException('Domain is required', HttpStatus.BAD_REQUEST);
    }
    try {
      const blueprint = await this.analyzerService.analyze(domain);
      return { success: true, blueprint };
    } catch (err) {
      throw new HttpException(
        `Failed to analyze storefront: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Post('export-zip')
  async exportThemeZip(
    @Body('blueprint') blueprint: StorefrontBlueprint,
    @Res() res: Response,
  ) {
    if (!blueprint || !blueprint.sourceDomain) {
      throw new HttpException('Valid blueprint is required', HttpStatus.BAD_REQUEST);
    }
    try {
      const zipBuffer = await this.packagerService.buildThemeZip(blueprint);
      const filename = `shopify-dawn-clone-${blueprint.sourceDomain.replace(/[^a-z0-9]/gi, '_')}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', zipBuffer.length);
      res.end(zipBuffer);
    } catch (err) {
      throw new HttpException(
        `Failed to build theme zip: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Get('download-zip')
  async downloadThemeZipByDomain(
    @Query('domain') domain: string,
    @Res() res: Response,
  ) {
    if (!domain) {
      throw new HttpException('Domain is required', HttpStatus.BAD_REQUEST);
    }
    try {
      const blueprint = await this.analyzerService.analyze(domain);
      const zipBuffer = await this.packagerService.buildThemeZip(blueprint);
      const filename = `shopify-dawn-clone-${blueprint.sourceDomain.replace(/[^a-z0-9]/gi, '_')}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', zipBuffer.length);
      res.end(zipBuffer);
    } catch (err) {
      throw new HttpException(
        `Failed to generate theme zip: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Post('export-content')
  async exportContentBundle(
    @Body('blueprint') blueprint: StorefrontBlueprint,
    @Res() res: Response,
  ) {
    if (!blueprint || !blueprint.sourceDomain) {
      throw new HttpException('Valid blueprint is required', HttpStatus.BAD_REQUEST);
    }
    try {
      const zipBuffer = await this.packagerService.buildContentPackageZip(blueprint);
      const filename = `storefront-content-${blueprint.sourceDomain.replace(/[^a-z0-9]/gi, '_')}.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', zipBuffer.length);
      res.end(zipBuffer);
    } catch (err) {
      throw new HttpException(
        `Failed to build content bundle: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Post('deploy-api')
  async deployDirect(
    @Body() body: { blueprint: StorefrontBlueprint; options: ThemeDeployOptions },
  ) {
    if (!body.blueprint) {
      throw new HttpException('Blueprint is required', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.deployerService.deploy(
        body.blueprint,
        body.options || {},
      );
      return result;
    } catch (err) {
      throw new HttpException(
        `Deployment failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
