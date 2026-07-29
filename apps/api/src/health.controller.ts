import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/roles.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}
