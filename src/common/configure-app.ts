import { INestApplication, ValidationPipe } from '@nestjs/common';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { HttpErrorFilter } from './http-error.filter';

export function configureApp(app: INestApplication): void {
  const config = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  app.setGlobalPrefix(config.apiPrefix.slice(1));
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new HttpErrorFilter());
  if (config.corsOrigin !== undefined) {
    app.enableCors({ origin: config.corsOrigin, credentials: false });
  }
}
