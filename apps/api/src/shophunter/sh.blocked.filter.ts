import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ShBlockedError } from './sh.client';
import { ShAuthError } from './sh.auth';

@Catch(ShBlockedError, ShAuthError)
export class ShBlockedFilter implements ExceptionFilter {
  catch(err: ShBlockedError | ShAuthError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = err instanceof ShAuthError ? HttpStatus.UNAUTHORIZED : HttpStatus.SERVICE_UNAVAILABLE;
    res.status(status).json({ statusCode: status, message: err.message });
  }
}
