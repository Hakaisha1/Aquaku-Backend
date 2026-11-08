import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { ConfigValidationError, RUNTIME_CONFIG, RuntimeConfig, validateConfig } from './config/runtime-config';

async function bootstrap(): Promise<void> {
  const result = loadEnv({ quiet: true });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error('Environment loading failed');
  }
  // Validate before Nest initializes so startup logging cannot print raw config errors.
  validateConfig(process.env);
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  try {
    configureApp(app);
    app.enableShutdownHooks();
    await app.listen(app.get<RuntimeConfig>(RUNTIME_CONFIG).port);
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error instanceof ConfigValidationError
    ? error.message
    : 'Application startup failed');
  process.exitCode = 1;
});
