import { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { createConnection, Types } from 'mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { RUNTIME_CONFIG, validateConfig } from '../src/config/runtime-config';
import { PrismaService } from '../src/database/prisma.service';
import { CLOUDINARY_CLIENT, CloudinaryClientPort } from '../src/marketplace/cloudinary-client';
import { MarketplaceService } from '../src/marketplace/marketplace.service';

function testConfig() {
  const config = validateConfig({
    APP_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/aquaku_test',
  });
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
    await module.get<Connection>(getConnectionToken()).asPromise();
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
      { migration_name: '20261110100000_membership_addons_admin' },
      { migration_name: '20261110110000_marketplace_trust_m5' },
      { migration_name: '20261112000000_otp_id_phone_verification' },
      { migration_name: '20261112100000_forum_media' },
    ]));
  });

  it('reports real database readiness through HTTP', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200)
      .expect({ data: { status: 'ready', checks: { database: 'up', forum_database: 'up' } } });
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

  it('reviews private membership and add-on proofs, verifies shops, and suspends/restores listings after downgrade', async () => {
    const createVerifiedSession = async (displayName: string) => {
      const email = `${randomUUID()}@example.com`;
      const registration = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'correct horse battery staple',
          display_name: displayName,
          phone_number: `0812${randomInt(10_000_000, 99_999_999)}`,
        })
        .expect(201);
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
      return { id: registration.body.data.id as string, accessToken };
    };

    let ownerId: string | undefined;
    let adminId: string | undefined;
    try {
      const owner = await createVerifiedSession('M4 Membership Seller');
      ownerId = owner.id;
      const admin = await createVerifiedSession('M4 Admin Reviewer');
      adminId = admin.id;
      await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });

      const plans = await request(app.getHttpServer()).get('/api/v1/marketplace/membership/plans').expect(200);
      expect(plans.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ tier: 'toko', price: 40_000 }),
        expect.objectContaining({ tier: 'juragan', price: 100_000 }),
      ]));

      const pdfProof = Buffer.from('%PDF-1.7 membership proof');
      const membership = await request(app.getHttpServer())
        .post('/api/v1/marketplace/me/membership-requests')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('tier', 'TOKO')
        .field('payment_amount', '40000')
        .attach('proof', pdfProof, { filename: 'receipt.pdf', contentType: 'application/pdf' })
        .expect(201);
      const requestId = membership.body.data.id as string;
      expect(membership.body.data).toMatchObject({ status: 'pending', proof_available: true });
      expect(membership.body.data).not.toHaveProperty('proof_bytes');
      await request(app.getHttpServer())
        .get(`/api/v1/marketplace/admin/benefit-requests/${requestId}/proof`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/api/v1/marketplace/admin/benefit-requests?status=PENDING')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: requestId })]));
          expect(JSON.stringify(body)).not.toContain('proof_bytes');
        });
      const proofDownload = await request(app.getHttpServer())
        .get(`/api/v1/marketplace/admin/benefit-requests/${requestId}/proof`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(proofDownload.headers['content-type']).toContain('application/pdf');
      expect(proofDownload.headers['cache-control']).toContain('no-store');

      const reviews = await Promise.all([1, 2].map(() => request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/benefit-requests/${requestId}/review`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ decision: 'APPROVED' })));
      expect(reviews.map((result) => result.status)).toEqual([201, 201]);
      const activeMembership = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(activeMembership.tier).toBe('TOKO');
      expect(activeMembership.tierExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

      await request(app.getHttpServer())
        .post('/api/v1/marketplace/shops')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ name: 'Verified Integration Shop' })
        .expect(201);
      const verification = await request(app.getHttpServer())
        .post('/api/v1/marketplace/me/shops/verification-requests')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/benefit-requests/${verification.body.data.id as string}/review`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ decision: 'APPROVED', review_note: 'Shop profile reviewed' })
        .expect(201);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).verifiedStore).toBe(true);

      const jpgProof = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
      const slotRequest = await request(app.getHttpServer())
        .post('/api/v1/marketplace/me/addon-requests')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('kind', 'SLOT_ADDON')
        .field('payment_amount', '20000')
        .field('slots', '2')
        .attach('proof', jpgProof, { filename: 'receipt.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/benefit-requests/${slotRequest.body.data.id as string}/review`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ decision: 'APPROVED', approved_slots: 3 })
        .expect(201);

      const passRequest = await request(app.getHttpServer())
        .post('/api/v1/marketplace/me/addon-requests')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .field('kind', 'COOLDOWN_BYPASS')
        .field('payment_amount', '10000')
        .attach('proof', jpgProof, { filename: 'pass.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/benefit-requests/${passRequest.body.data.id as string}/review`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ decision: 'APPROVED' })
        .expect(201);
      const entitlements = await request(app.getHttpServer())
        .get('/api/v1/marketplace/me/entitlements')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(entitlements.body.data).toMatchObject({ addon_slots: 3, available_cooldown_passes: 1 });

      const cooldownUntil = new Date(Date.now() + 86_400_000);
      await prisma.user.update({
        where: { id: owner.id },
        data: { tier: 'PERSONAL', tierExpiresAt: null, personalCooldownUntil: cooldownUntil },
      });
      const regions = await prisma.region.findFirstOrThrow();
      const category = await prisma.category.findFirstOrThrow();
      const photoIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const photo = await prisma.mediaAsset.create({
          data: {
            ownerId: owner.id,
            publicId: `m4_${owner.id.replaceAll('-', '')}_${randomUUID().replaceAll('-', '')}`,
            signedAt: new Date(),
            uploadedAt: new Date(),
            secureUrl: 'https://example.test/private-test-photo.webp',
            format: 'webp',
            bytes: 1024,
          },
        });
        photoIds.push(photo.id);
      }
      const listingResponse = await request(app.getHttpServer())
        .post('/api/v1/marketplace/listings')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          category_id: category.id,
          region_code: regions.code,
          title: 'Cooldown pass test listing',
          description: 'A test listing created using one approved cooldown pass.',
          price: 1000,
          condition: 'SECOND',
          photo_ids: photoIds,
          cooldown_pass_id: entitlements.body.data.available_cooldown_passes === 1
            ? (await prisma.cooldownPass.findFirstOrThrow({ where: { userId: owner.id } })).id
            : undefined,
        })
        .expect(201);
      const listingId = listingResponse.body.data.id as string;
      const pass = await prisma.cooldownPass.findFirstOrThrow({ where: { userId: owner.id } });
      expect(pass.consumedAt).toBeInstanceOf(Date);

      const now = new Date();
      await prisma.slotAddonGrant.updateMany({
        where: { userId: owner.id },
        data: { expiresAt: new Date(now.getTime() - 1000) },
      });
      await prisma.user.update({
        where: { id: owner.id },
        data: { tier: 'TOKO', tierExpiresAt: new Date(now.getTime() - 1000), personalCooldownUntil: null },
      });
      const conditionListing = await prisma.listing.create({
        data: {
          sellerId: owner.id,
          categoryId: category.id,
          regionCode: regions.code,
          title: 'New condition listing to suspend',
          description: 'This listing must be suspended after paid membership expires.',
          price: 2000,
          condition: 'NEW',
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          createdAt: new Date(now.getTime() - 10 * 86_400_000),
        },
      });
      for (let index = 0; index < 6; index += 1) {
        await prisma.listing.create({
          data: {
            sellerId: owner.id,
            categoryId: category.id,
            regionCode: regions.code,
            title: `Second listing ${index}`,
            description: 'Eligible listing for deterministic quota downgrade handling.',
            price: 3000 + index,
            condition: 'SECOND',
            expiresAt: new Date(now.getTime() + 30 * 86_400_000),
            createdAt: new Date(now.getTime() - (9 - index) * 86_400_000),
          },
        });
      }
      const marketplace = app.get(MarketplaceService);
      await marketplace.expireDueListings();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).tier).toBe('PERSONAL');
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: conditionListing.id } })).suspensionReason)
        .toBe('TIER_CONDITION');
      const downgradedActiveCount = await prisma.listing.count({
        where: { sellerId: owner.id, status: 'ACTIVE', deletedAt: null },
      });
      expect(downgradedActiveCount).toBe(5);
      const downgradedListing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
      expect(downgradedListing.status).toBe('INACTIVE');
      expect(downgradedListing.suspensionReason).toBe('QUOTA');
      const oldExpiry = downgradedListing.expiresAt;

      await prisma.user.update({
        where: { id: owner.id },
        data: { tier: 'TOKO', tierExpiresAt: new Date(Date.now() + 30 * 86_400_000) },
      });
      const reactivated = await request(app.getHttpServer())
        .post(`/api/v1/marketplace/listings/${listingId}/reactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(201);
      expect(reactivated.body.data.status).toBe('active');
      expect(new Date(reactivated.body.data.expires_at as string).getTime()).toBeGreaterThan(oldExpiry.getTime());
    } finally {
      if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
      if (adminId) await prisma.user.delete({ where: { id: adminId } });
    }
  });

  it('requires buyer confirmation for ratings and supports reports and audited listing moderation', async () => {
    const createVerifiedSession = async (displayName: string) => {
      const email = `${randomUUID()}@example.com`;
      const registration = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'correct horse battery staple',
          display_name: displayName,
          phone_number: `0812${randomInt(10_000_000, 99_999_999)}`,
        })
        .expect(201);
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
      return { id: registration.body.data.id as string, accessToken };
    };

    let sellerId: string | undefined;
    let buyerOneId: string | undefined;
    let buyerTwoId: string | undefined;
    let adminId: string | undefined;
    try {
      const seller = await createVerifiedSession('M5 Seller');
      sellerId = seller.id;
      const buyerOne = await createVerifiedSession('M5 Buyer One');
      buyerOneId = buyerOne.id;
      const buyerTwo = await createVerifiedSession('M5 Buyer Two');
      buyerTwoId = buyerTwo.id;
      const admin = await createVerifiedSession('M5 Moderator');
      adminId = admin.id;
      await prisma.user.update({
        where: { id: seller.id },
        data: { tier: 'TOKO', tierExpiresAt: new Date(Date.now() + 30 * 86_400_000) },
      });
      await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });

      const [regions, taxonomy] = await Promise.all([
        request(app.getHttpServer()).get('/api/v1/marketplace/regions').expect(200),
        request(app.getHttpServer()).get('/api/v1/marketplace/taxonomy').expect(200),
      ]);
      const createListing = async (title: string) => {
        const photoIds: string[] = [];
        for (let index = 0; index < 3; index += 1) {
          const signature = await request(app.getHttpServer())
            .post('/api/v1/marketplace/media/upload-signatures')
            .set('Authorization', `Bearer ${seller.accessToken}`)
            .expect(201);
          const confirmed = await request(app.getHttpServer())
            .post('/api/v1/marketplace/media/confirm-upload')
            .set('Authorization', `Bearer ${seller.accessToken}`)
            .send({ asset_id: signature.body.data.asset_id })
            .expect(201);
          photoIds.push(confirmed.body.data.id as string);
        }
        const response = await request(app.getHttpServer())
          .post('/api/v1/marketplace/listings')
          .set('Authorization', `Bearer ${seller.accessToken}`)
          .send({
            category_id: taxonomy.body.data.categories[0].id as string,
            region_code: regions.body.data[0].code as string,
            title,
            description: 'A marketplace trust integration-test listing.',
            price: 50000,
            condition: 'SECOND',
            photo_ids: photoIds,
          })
          .expect(201);
        return response.body.data.id as string;
      };

      const transactionListingId = await createListing('M5 confirmed transaction listing');
      const sold = await request(app.getHttpServer())
        .post(`/api/v1/marketplace/listings/${transactionListingId}/sold`)
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .send({ buyer_id: buyerOne.id })
        .expect(201);
      const firstSaleId = sold.body.data.transaction.id as string;
      expect(sold.body.data.transaction.status).toBe('awaiting_confirmation');
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${firstSaleId}/respond`)
        .set('Authorization', `Bearer ${buyerTwo.accessToken}`)
        .send({ decision: 'CONFIRM' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${firstSaleId}/rating`)
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .send({ score: 5 })
        .expect(409);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${firstSaleId}/respond`)
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .send({ decision: 'REJECT', note: 'I did not buy this item' })
        .expect(201)
        .expect(({ body }) => expect(body.data.status).toBe('rejected'));
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: transactionListingId } })).status).toBe('SOLD');

      const reassigned = await request(app.getHttpServer())
        .post(`/api/v1/marketplace/listings/${transactionListingId}/sale`)
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .send({ buyer_id: buyerTwo.id })
        .expect(201);
      const secondSaleId = reassigned.body.data.id as string;
      const confirmations = await Promise.all([1, 2].map(() => request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${secondSaleId}/respond`)
        .set('Authorization', `Bearer ${buyerTwo.accessToken}`)
        .send({ decision: 'CONFIRM' })));
      expect(confirmations.map((response) => response.status)).toEqual([201, 201]);
      const rating = await request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${secondSaleId}/rating`)
        .set('Authorization', `Bearer ${buyerTwo.accessToken}`)
        .send({ score: 5 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${secondSaleId}/rating`)
        .set('Authorization', `Bearer ${buyerTwo.accessToken}`)
        .send({ score: 4 })
        .expect(409);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/listings/${transactionListingId}/sale`)
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .send({ buyer_id: buyerOne.id })
        .expect(409);
      const corrected = await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/sales/${secondSaleId}/correct-buyer`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ buyer_id: buyerOne.id, reason: 'Seller provided the wrong buyer account' })
        .expect(201);
      expect(corrected.body.data).toMatchObject({ id: secondSaleId, status: 'awaiting_confirmation', rating: null });
      await request(app.getHttpServer())
        .get(`/api/v1/marketplace/admin/sales/${secondSaleId}/corrections`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200)
        .expect(({ body }) => expect(body.data).toHaveLength(1));
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${secondSaleId}/respond`)
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .send({ decision: 'CONFIRM' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/sales/${secondSaleId}/rating`)
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .send({ score: 4 })
        .expect(201);
      const publicSeller = await request(app.getHttpServer())
        .get(`/api/v1/users/${seller.id}`)
        .expect(200);
      expect(publicSeller.body.data).toMatchObject({ rating_average: 4, rating_count: 1 });
      expect(rating.body.data.score).toBe(5);
      expect(await prisma.saleTransactionCorrection.count({ where: { saleTransactionId: secondSaleId } })).toBe(1);

      const hiddenListingId = await createListing('M5 listing to moderate');
      const listingReport = await request(app.getHttpServer())
        .post('/api/v1/marketplace/reports')
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .send({ target_type: 'LISTING', target_id: hiddenListingId, reason: 'MISLEADING', details: 'Test report' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/marketplace/reports')
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .send({ target_type: 'LISTING', target_id: hiddenListingId, reason: 'SPAM' })
        .expect(409);
      await request(app.getHttpServer())
        .get('/api/v1/marketplace/admin/reports')
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/listings/${hiddenListingId}/moderation`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ action: 'HIDE', reason: 'Pending review of a misleading listing report' })
        .expect(201);
      await request(app.getHttpServer()).get(`/api/v1/marketplace/listings/${hiddenListingId}`).expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/listings/${hiddenListingId}/moderation`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ action: 'RESTORE', reason: 'Review completed; listing may be visible' })
        .expect(201);
      await request(app.getHttpServer()).get(`/api/v1/marketplace/listings/${hiddenListingId}`).expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/marketplace/admin/listings/${hiddenListingId}/moderation`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200)
        .expect(({ body }) => expect(body.data).toHaveLength(2));
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/reports/${listingReport.body.data.id as string}/review`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ decision: 'RESOLVED', review_note: 'Listing moderation action recorded' })
        .expect(201);

      const userReport = await request(app.getHttpServer())
        .post('/api/v1/marketplace/reports')
        .set('Authorization', `Bearer ${buyerOne.accessToken}`)
        .send({ target_type: 'USER', target_id: seller.id, reason: 'OTHER' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/marketplace/admin/reports/${userReport.body.data.id as string}/review`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ decision: 'DISMISSED', review_note: 'No further action required' })
        .expect(201);

      const unlinkedListingId = await createListing('M5 sale without account buyer');
      const unlinkedSale = await request(app.getHttpServer())
        .post(`/api/v1/marketplace/listings/${unlinkedListingId}/sold`)
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .expect(201);
      expect(unlinkedSale.body.data.transaction).toBeNull();
      expect(await prisma.saleTransaction.count({ where: { listingId: unlinkedListingId } })).toBe(0);
      expect(await prisma.moderationAction.count({ where: { listingId: hiddenListingId } })).toBe(2);
    } finally {
      if (sellerId) await prisma.user.delete({ where: { id: sellerId } });
      if (buyerOneId) await prisma.user.delete({ where: { id: buyerOneId } });
      if (buyerTwoId) await prisma.user.delete({ where: { id: buyerTwoId } });
      if (adminId) await prisma.user.delete({ where: { id: adminId } });
    }
  });

  it('stores forum content in MongoDB and enforces verified-user/admin workflows', async () => {
    const createVerifiedSession = async (displayName: string) => {
      const email = `${randomUUID()}@example.com`;
      const registration = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password: 'correct horse battery staple',
          display_name: displayName,
          phone_number: `0812${randomInt(10_000_000, 99_999_999)}`,
        })
        .expect(201);
      const id = registration.body.data.id as string;
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'correct horse battery staple' })
        .expect(200);
      const accessToken = login.body.data.access_token as string;
      await request(app.getHttpServer())
        .post('/api/v1/auth/verify-phone')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: registration.body.development_otp })
        .expect(200);
      return { id, accessToken };
    };

    const author = await createVerifiedSession('Forum Author');
    const admin = await createVerifiedSession('Forum Moderator');
    let categoryId: string | undefined;
    let postId: string | undefined;
    try {
      await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
      const createdCategory = await request(app.getHttpServer())
        .post('/api/v1/forum/admin/categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: `Aquascape ${randomUUID().slice(0, 8)}`, description: 'Forum integration test' })
        .expect(201);
      categoryId = createdCategory.body.data.id as string;

      const createdPost = await request(app.getHttpServer())
        .post('/api/v1/forum/posts')
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ category_id: categoryId, title: 'Tank update', body: 'Plants are growing well' })
        .expect(201);
      postId = createdPost.body.data.id as string;
      expect(createdPost.body.data.author).toMatchObject({ id: author.id, display_name: 'Forum Author' });

      await request(app.getHttpServer()).get('/api/v1/forum/posts').expect(200)
        .expect(({ body }) => expect(body.data.items).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: postId, title: 'Tank update' }),
        ])));
      await request(app.getHttpServer())
        .post(`/api/v1/forum/posts/${postId}/comments`)
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ body: 'Thanks for sharing' })
        .expect(201);
      await request(app.getHttpServer()).get(`/api/v1/forum/posts/${postId}/comments`).expect(200)
        .expect(({ body }) => expect(body.data.items).toEqual([
          expect.objectContaining({ body: 'Thanks for sharing', author: expect.objectContaining({ id: author.id }) }),
        ]));

      const createdReport = await request(app.getHttpServer())
        .post(`/api/v1/forum/posts/${postId}/reports`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'other', details: 'Integration test report' })
        .expect(201);
      const reportId = createdReport.body.data.id as string;
      await request(app.getHttpServer())
        .post(`/api/v1/forum/admin/reports/${reportId}/review`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ decision: 'resolved', review_note: 'Reviewed in test' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/forum/admin/posts/${postId}/moderation`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ action: 'hide', reason: 'Test moderation' })
        .expect(201);
      await request(app.getHttpServer()).get(`/api/v1/forum/posts/${postId}`).expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/forum/admin/posts/${postId}/moderation`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ action: 'restore', reason: 'Restore test post' })
        .expect(201);
      await request(app.getHttpServer()).get(`/api/v1/forum/posts/${postId}`).expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/forum/admin/posts/${postId}/moderation`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200)
        .expect(({ body }) => expect(body.data).toHaveLength(2));
    } finally {
      const mongo = app.get<Connection>(getConnectionToken());
      if (postId) {
        const postObjectId = new Types.ObjectId(postId);
        await Promise.all([
          mongo.collection('forum_comments').deleteMany({ postId: postObjectId }),
          mongo.collection('forum_reports').deleteMany({ postId: postObjectId }),
          mongo.collection('forum_moderation_actions').deleteMany({ postId: postObjectId }),
          mongo.collection('forum_posts').deleteMany({ _id: postObjectId }),
        ]);
      }
      if (categoryId) {
        await mongo.collection('forum_categories').deleteOne({ _id: new Types.ObjectId(categoryId) });
      }
      await prisma.user.deleteMany({ where: { id: { in: [author.id, admin.id] } } });
    }
  });

  it('returns 503 for an unreachable database while liveness stays available', async () => {
    const config = testConfig();
    const unavailableUrl = new URL(config.databaseUrl);
    unavailableUrl.hostname = '127.0.0.1';
    unavailableUrl.port = '1';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(validateConfig({ APP_ENV: 'test', DATABASE_URL: unavailableUrl.toString() }))
      .overrideProvider(getConnectionToken()).useValue(createConnection()).compile();
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
