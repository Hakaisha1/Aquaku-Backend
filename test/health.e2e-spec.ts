import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { RUNTIME_CONFIG, validateConfig } from '../src/config/runtime-config';
import { PrismaService } from '../src/database/prisma.service';

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;
  const query = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(validateConfig({ DATABASE_URL: 'postgresql://localhost/aquaku_test' }))
      .overrideProvider(PrismaService).useValue({ $queryRaw: query }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => query.mockReset());
  afterAll(async () => { await app.close(); });

  it('returns liveness without a database query', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live')
      .expect(200).expect({ data: { status: 'ok' } });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns readiness when the database is available', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    await request(app.getHttpServer()).get('/api/v1/health/ready')
      .expect(200).expect({ data: { status: 'ready', checks: { database: 'up' } } });
  });

  it('returns safe 503 and keeps liveness available during an outage', async () => {
    query.mockRejectedValue(new Error('private connection credentials'));
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503)
      .expect({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' } });
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
