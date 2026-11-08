import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const errors: Readonly<Record<number, { code: string; message: string }>> = {
  400: { code: 'VALIDATION_ERROR', message: 'Request validation failed' },
  401: { code: 'UNAUTHORIZED', message: 'Authentication required' },
  403: { code: 'FORBIDDEN', message: 'Access denied' },
  404: { code: 'NOT_FOUND', message: 'Resource not found' },
  409: { code: 'CONFLICT', message: 'Request conflicts with the current state' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
  500: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const requestedStatus = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = errors[status] ?? (status >= 500
      ? errors[500]
      : { code: 'HTTP_ERROR', message: 'Request failed' });

    // Exception messages and responses may contain credentials or database details.
    host.switchToHttp().getResponse<Response>().status(status).json({ error });
  }
}
