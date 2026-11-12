import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { RUNTIME_CONFIG, validateConfig } from '../src/config/runtime-config';
import { PrismaService } from '../src/database/prisma.service';
import { getConnectionToken } from '@nestjs/mongoose';
import { model } from 'mongoose';

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;
  const query = jest.fn();
  const ping = jest.fn();
  const mongo = {
    readyState: 1,
    db: { admin: () => ({ ping }) },
    models: {},
    model: (name: string, schema: Parameters<typeof model>[1], collection?: string) => model(name, schema, collection),
    close: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(validateConfig({ DATABASE_URL: 'postgresql://localhost/aquaku_test' }))
      .overrideProvider(PrismaService).useValue({ $queryRaw: query })
      .overrideProvider(getConnectionToken()).useValue(mongo).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => { query.mockReset(); ping.mockReset(); ping.mockResolvedValue({ ok: 1 }); });
  afterAll(async () => { await app.close(); });

  it('returns liveness without a database query', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live')
      .expect(200).expect({ data: { status: 'ok' } });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns readiness when the database is available', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    await request(app.getHttpServer()).get('/api/v1/health/ready')
      .expect(200).expect({ data: { status: 'ready', checks: { database: 'up', forum_database: 'up' } } });
  });

  it('returns safe 503 when MongoDB is unavailable', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockRejectedValue(new Error('private MongoDB credentials'));
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503)
      .expect({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' } });
  });

  it('returns safe 503 and keeps liveness available during an outage', async () => {
    query.mockRejectedValue(new Error('private connection credentials'));
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503)
      .expect({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' } });
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
