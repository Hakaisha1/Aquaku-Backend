import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { RUNTIME_CONFIG, RuntimeConfig } from './config/runtime-config';

@Injectable()
class ConfigConsumer {
  constructor(@Inject(RUNTIME_CONFIG) readonly config: RuntimeConfig) {}
}

@Module({ providers: [ConfigConsumer], exports: [ConfigConsumer] })
class ConsumerModule {}

describe('AppModule', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      APP_ENV: 'test', DATABASE_URL: 'postgresql://localhost/aquaku_test',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('provides validated configuration globally through DI', async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule, ConsumerModule],
    }).compile();
    try {
      expect(module.get(AppModule)).toBeInstanceOf(AppModule);
      expect(module.get(ConfigConsumer).config).toBe(module.get(RUNTIME_CONFIG));
      expect(module.get(ConfigConsumer).config).toEqual({
        appEnv: 'test', port: 3000, apiPrefix: '/api/v1',
        databaseUrl: 'postgresql://localhost/aquaku_test',
      });
    } finally {
      await module.close();
    }
  });

  it('fails module startup when runtime configuration is invalid', async () => {
    process.env.DATABASE_URL = 'invalid-secret-connection-string';
    await expect(Test.createTestingModule({ imports: [AppModule] }).compile())
      .rejects.toThrow('Invalid configuration fields: DATABASE_URL');
  });
});
