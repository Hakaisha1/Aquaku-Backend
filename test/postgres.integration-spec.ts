import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { RUNTIME_CONFIG, validateConfig } from '../src/config/runtime-config';
import { PrismaService } from '../src/database/prisma.service';

function testConfig() {
  const config = validateConfig({ APP_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL });
  if (!new URL(config.databaseUrl).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must target a dedicated database ending in _test');
  }
  return config;
}

describe('PostgreSQL integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUNTIME_CONFIG).useValue(testConfig()).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => { if (app) await app.close(); });

  it('executes a real PostgreSQL query', async () => {
    const rows = await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1::int AS value`;
    expect(rows).toEqual([{ value: 1 }]);
  });

  it('has successfully applied the baseline migration', async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    expect(rows).toEqual(expect.arrayContaining([
      { migration_name: '20261108000000_initialize_schema' },
    ]));
  });

  it('reports real database readiness through HTTP', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200)
      .expect({ data: { status: 'ready', checks: { database: 'up' } } });
  });

  it('returns 503 for an unreachable database while liveness stays available', async () => {
    const config = testConfig();
    const unavailableUrl = new URL(config.databaseUrl);
    unavailableUrl.hostname = '127.0.0.1';
    unavailableUrl.port = '1';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(validateConfig({ APP_ENV: 'test', DATABASE_URL: unavailableUrl.toString() })).compile();
    const unavailableApp = module.createNestApplication();
    configureApp(unavailableApp);
    await unavailableApp.init();
    try {
      await request(unavailableApp.getHttpServer()).get('/api/v1/health/ready')
        .expect(503).expect({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
        });
      await request(unavailableApp.getHttpServer()).get('/api/v1/health/live')
        .expect(200).expect({ data: { status: 'ok' } });
    } finally {
      await unavailableApp.close();
    }
  });
});
