import { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
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

  it('completes account registration, login, OTP verification, refresh rotation, and profile access', async () => {
    const email = `${randomUUID()}@example.com`;
    const phoneNumber = `0812${randomInt(10_000_000, 99_999_999)}`;
    let userId: string | undefined;
    try {
      const registration = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'correct horse battery staple',
          display_name: 'Integration User',
          phone_number: phoneNumber,
        })
        .expect(201);
      const registered = registration.body as {
        data: { id: string; phone_verified: boolean };
        development_otp: string;
      };
      userId = registered.data.id;
      expect(registered.data.phone_verified).toBe(false);
      expect(registered.development_otp).toMatch(/^\d{6}$/);
      expect(registration.text).not.toContain('password_hash');

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'correct horse battery staple' })
        .expect(200);
      const tokens = login.body.data as { access_token: string; refresh_token: string };
      await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: tokens.refresh_token })
        .expect(200);
      const rotated = refreshed.body.data as { access_token: string; refresh_token: string };
      expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: tokens.refresh_token })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-phone')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .send({ code: registered.development_otp })
        .expect(200)
        .expect(({ body }) => expect(body.data.phone_verified).toBe(true));

      const ownProfile = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .expect(200);
      expect(ownProfile.body.data).toMatchObject({
        id: userId,
        email,
        display_name: 'Integration User',
        phone_verified: true,
        tier: 'personal',
        role: 'member',
      });
      expect(ownProfile.body.data).not.toHaveProperty('password_hash');
      expect(ownProfile.body.data).not.toHaveProperty('phone_number');

      const publicProfile = await request(app.getHttpServer())
        .get(`/api/v1/users/${userId}`)
        .expect(200);
      expect(publicProfile.body.data).toMatchObject({
        id: userId,
        display_name: 'Integration User',
        tier: 'personal',
      });
      expect(publicProfile.body.data).not.toHaveProperty('email');
      expect(publicProfile.body.data).not.toHaveProperty('phone_number');
    } finally {
      if (userId) await prisma.user.delete({ where: { id: userId } });
    }
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
