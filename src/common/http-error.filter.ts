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
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Request media type is not supported' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
  500: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
};

function middlewareStatus(exception: unknown): number {
  if (!(exception instanceof Error) || !('type' in exception)) return 500;
  // Recognize body-parser failures without trusting arbitrary status properties.
  switch (exception.type) {
    case 'entity.too.large': return 413;
    case 'encoding.unsupported':
    case 'charset.unsupported': return 415;
    case 'entity.parse.failed':
    case 'request.aborted':
    case 'request.size.invalid': return 400;
    default: return 500;
  }
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const requestedStatus = exception instanceof HttpException
      ? exception.getStatus()
      : middlewareStatus(exception);
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
