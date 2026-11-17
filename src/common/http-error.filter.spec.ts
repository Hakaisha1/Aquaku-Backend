import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpErrorFilter } from './http-error.filter';

describe('HttpErrorFilter', () => {
  let filter: HttpErrorFilter;
  let mockResponse: {
    status: jest.Mock;
    json: jest.Mock;
  };
  let mockHost: ArgumentsHost;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new HttpErrorFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
    } as unknown as ArgumentsHost;
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs errors with stack trace when status >= 500 and returns sanitized error envelope', () => {
    const error = new Error('Database connection failed: secret_credentials');
    filter.catch(error, mockHost);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[500] Database connection failed: secret_credentials'),
      error.stack,
    );
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  it('does not log server errors when status < 500', () => {
    const notFoundException = new HttpException('Not found', HttpStatus.NOT_FOUND);
    filter.catch(notFoundException, mockHost);

    expect(loggerErrorSpy).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });
});
