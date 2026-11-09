import { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { RUNTIME_CONFIG, validateConfig } from '../src/config/runtime-config';
import { PrismaService } from '../src/database/prisma.service';
import { CLOUDINARY_CLIENT, CloudinaryClientPort } from '../src/marketplace/cloudinary-client';
import { MarketplaceService } from '../src/marketplace/marketplace.service';

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
    const fakeCloudinary: CloudinaryClientPort = {
      createUploadSignature: (ownerId) => {
        const timestamp = Math.floor(Date.now() / 1000);
        return {
          cloudName: 'test-cloud',
          apiKey: 'test-key',
          timestamp,
          publicId: `aquaku_${ownerId.replaceAll('-', '')}_${randomUUID().replaceAll('-', '')}`,
          folder: 'aquaku/listings',
          allowedFormats: 'jpg,png,webp',
          uploadPreset: 'test-preset',
          overwrite: 'false',
          signature: 'test-signature',
        };
      },
      verifyUpload: async (publicId) => ({
        publicId,
        secureUrl: `https://res.cloudinary.com/test-cloud/image/upload/${publicId}.webp`,
        format: 'webp',
        bytes: 1024,
      }),
      deleteAsset: async () => undefined,
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUNTIME_CONFIG).useValue(testConfig())
      .overrideProvider(CLOUDINARY_CLIENT).useValue(fakeCloudinary).compile();
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

      const regions = await request(app.getHttpServer())
        .get('/api/v1/marketplace/regions')
        .expect(200);
      expect(regions.body.data).toHaveLength(177);
      const taxonomy = await request(app.getHttpServer())
        .get('/api/v1/marketplace/taxonomy')
        .expect(200);
      expect(taxonomy.body.data.categories.length).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .send({ whatsapp_number: '081234567890' })
        .expect(200);

      const photoIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const signature = await request(app.getHttpServer())
          .post('/api/v1/marketplace/media/upload-signatures')
          .set('Authorization', `Bearer ${rotated.access_token}`)
          .expect(201);
        expect(signature.body.data.upload_preset).toBe('test-preset');
        const confirmed = await request(app.getHttpServer())
          .post('/api/v1/marketplace/media/confirm-upload')
          .set('Authorization', `Bearer ${rotated.access_token}`)
          .send({ asset_id: signature.body.data.asset_id })
          .expect(201);
        photoIds.push(confirmed.body.data.id as string);
      }

      const listingInput = {
        category_id: taxonomy.body.data.categories[0].id as string,
        region_code: regions.body.data[0].code as string,
        title: 'Aquascape integration listing',
        description: 'A tested listing flow for marketplace integration.',
        price: 125000,
        condition: 'SECOND',
        photo_ids: photoIds,
      };
      await request(app.getHttpServer())
        .post('/api/v1/marketplace/listings')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .send({ ...listingInput, region_code: '33.99.99.1001' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/marketplace/listings')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .send({ ...listingInput, condition: 'NEW' })
        .expect(403);
      const listing = await request(app.getHttpServer())
        .post('/api/v1/marketplace/listings')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .send(listingInput)
        .expect(201);
      expect(listing.body.data).toMatchObject({
        title: 'Aquascape integration listing',
        price: 125000,
        condition: 'second',
        photos: expect.arrayContaining([expect.objectContaining({ url: expect.stringContaining('cloudinary.com') })]),
        seller: { whatsapp_url: 'https://wa.me/6281234567890' },
      });
      const search = await request(app.getHttpServer())
        .get('/api/v1/marketplace/listings')
        .query({
          q: 'integration',
          category: taxonomy.body.data.categories[0].slug,
          condition: 'SECOND',
          min_price: 100000,
          max_price: 200000,
          region_code: regions.body.data[0].code,
          sort: 'price_asc',
          page: 1,
          limit: 10,
        })
        .expect(200);
      expect(search.body.data).toMatchObject({ pagination: { page: 1, limit: 10, total: 1 } });
      const myListings = await request(app.getHttpServer())
        .get('/api/v1/marketplace/me/listings')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .expect(200);
      expect(myListings.body.data).toMatchObject({
        pagination: { page: 1, limit: 20, total: 1 },
        items: [expect.objectContaining({ id: listing.body.data.id, status: 'active' })],
      });
      await request(app.getHttpServer())
        .patch(`/api/v1/marketplace/listings/${listing.body.data.id as string}`)
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .send({ title: 'Aquascape integration listing updated' })
        .expect(200);
      const foundListing = await request(app.getHttpServer())
        .get(`/api/v1/marketplace/listings/${listing.body.data.id as string}`)
        .expect(200);
      expect(foundListing.body.data.id).toBe(listing.body.data.id);
      await request(app.getHttpServer())
        .delete(`/api/v1/marketplace/listings/${listing.body.data.id as string}`)
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/marketplace/listings/${listing.body.data.id as string}`)
        .expect(404);
      const quota = await request(app.getHttpServer())
        .get('/api/v1/marketplace/me/quota')
        .set('Authorization', `Bearer ${rotated.access_token}`)
        .expect(200);
      expect(quota.body.data).toMatchObject({
        active_listings: 0,
        base_quota: 5,
        may_list: false,
      });
      expect(quota.body.data.cooldown_until).toBeTruthy();
    } finally {
      if (userId) await prisma.user.delete({ where: { id: userId } });
    }
  });

  it('serializes concurrent listing creation and starts cooldown when a full Personal listing sells', async () => {
    const email = `${randomUUID()}@example.com`;
    const phoneNumber = `0812${randomInt(10_000_000, 99_999_999)}`;
    let userId: string | undefined;
    try {
      const registration = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'correct horse battery staple',
          display_name: 'Concurrent Seller',
          phone_number: phoneNumber,
        })
        .expect(201);
      userId = registration.body.data.id as string;
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'correct horse battery staple' })
        .expect(200);
      const accessToken = login.body.data.access_token as string;
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-phone')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: registration.body.development_otp as string })
        .expect(200);
      const regions = await request(app.getHttpServer()).get('/api/v1/marketplace/regions').expect(200);
      const taxonomy = await request(app.getHttpServer()).get('/api/v1/marketplace/taxonomy').expect(200);
      const photoBatches: string[][] = [];
      for (let listingIndex = 0; listingIndex < 6; listingIndex += 1) {
        const photoIds: string[] = [];
        for (let photoIndex = 0; photoIndex < 3; photoIndex += 1) {
          const signature = await request(app.getHttpServer())
            .post('/api/v1/marketplace/media/upload-signatures')
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(201);
          const confirmed = await request(app.getHttpServer())
            .post('/api/v1/marketplace/media/confirm-upload')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ asset_id: signature.body.data.asset_id })
            .expect(201);
          photoIds.push(confirmed.body.data.id as string);
        }
        photoBatches.push(photoIds);
      }
      const bodyFor = (index: number) => ({
        category_id: taxonomy.body.data.categories[0].id as string,
        region_code: regions.body.data[0].code as string,
        title: `Concurrent listing ${index}`,
        description: 'Concurrency test listing with verified image assets.',
        price: 100000 + index,
        condition: 'SECOND',
        photo_ids: photoBatches[index],
      });
      const outcomes = await Promise.all(photoBatches.map((_, index) =>
        request(app.getHttpServer())
          .post('/api/v1/marketplace/listings')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(bodyFor(index)),
      ));
      const successful = outcomes.filter((outcome) => outcome.status === 201);
      const rejected = outcomes.filter((outcome) => outcome.status === 409);
      expect(successful).toHaveLength(5);
      expect(rejected).toHaveLength(1);
      const expiring = successful[0].body.data.id as string;
      await prisma.listing.update({
        where: { id: expiring },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const marketplace = app.get(MarketplaceService);
      expect(await marketplace.expireDueListings()).toBe(1);
      expect(await marketplace.expireDueListings()).toBe(0);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: expiring } })).status).toBe('EXPIRED');
      const sold = successful[1].body.data.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/listings/${sold}/sold`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      const quota = await request(app.getHttpServer())
        .get('/api/v1/marketplace/me/quota')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(quota.body.data).toMatchObject({
        active_listings: 3,
        base_quota: 5,
        may_list: false,
      });
      expect(new Date(quota.body.data.cooldown_until as string).getTime())
        .toBeGreaterThan(Date.now() + 6 * 86_400_000);
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
