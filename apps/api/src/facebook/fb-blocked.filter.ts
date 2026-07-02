import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { FbBlockedError } from './fb.playwright.service';

@Catch(FbBlockedError)
export class FbBlockedFilter implements ExceptionFilter {
  catch(exception: FbBlockedError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: exception.message,
      error: 'FbBlocked',
    });
  }
}
