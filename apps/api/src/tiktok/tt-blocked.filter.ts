import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { TtBlockedError } from './tiktok.service';

@Catch(TtBlockedError)
export class TtBlockedFilter implements ExceptionFilter {
  catch(exception: TtBlockedError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: exception.message,
      error: 'TtBlocked',
    });
  }
}
