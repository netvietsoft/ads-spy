import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { GoogleBlockedError } from './google.client';

// Đổi GoogleBlockedError thành HTTP 503 kèm thông báo thân thiện thay vì 500.
@Catch(GoogleBlockedError)
export class GoogleBlockedFilter implements ExceptionFilter {
  catch(exception: GoogleBlockedError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: exception.message,
      error: 'GoogleBlocked',
    });
  }
}
