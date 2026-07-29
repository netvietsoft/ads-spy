import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/roles.decorator';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private catalog: CatalogService) {}
  @Public() @Get('plans') plans() { return this.catalog.listPlans(undefined, true); }
  @Public() @Get('modules') modules() { return this.catalog.listModules(true); }
}
