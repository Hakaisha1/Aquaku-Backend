import {
  Body, Controller, Get, HttpException, INestApplication, Param, Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { RUNTIME_CONFIG, validateConfig } from '../src/config/runtime-config';

class CreateItemDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

const secret = 'postgresql://private-user:private-password@private-host/private-db';

@Controller('http-test')
class HttpTestController {
  @Post('items')
  create(@Body() body: CreateItemDto): CreateItemDto {
    return body;
  }

  @Get('internal')
  internal(): never {
    throw new Error(`Database connection failed: ${secret}`);
  }

  @Get('status/:status')
  status(@Param('status') status: string): never {
    throw new HttpException({ message: secret, details: secret, stack: secret }, Number(status));
  }
}

describe.each([
  { label: 'without CORS', origin: undefined },
  { label: 'with an explicit CORS origin', origin: 'https://aquaku.example.com' },
])('HTTP foundation $label (e2e)', ({ origin }) => {
  let app: INestApplication;

  beforeAll(async () => {
    const config = validateConfig({
      APP_ENV: 'production', DATABASE_URL: 'postgresql://localhost/aquaku_test',
      ...(origin === undefined ? {} : { CORS_ORIGIN: origin }),
    });
    const module = await Test.createTestingModule({
      imports: [AppModule], controllers: [HttpTestController],
    }).overrideProvider(RUNTIME_CONFIG).useValue(config).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => { if (app) await app.close(); });

  it('serves validated DTOs beneath the API prefix', async () => {
    await request(app.getHttpServer()).post('/api/v1/http-test/items')
      .send({ name: 'Aquarium', quantity: 2 }).expect(201)
      .expect({ name: 'Aquarium', quantity: 2 });
  });

  it.each([
    { name: 'A', quantity: 2 },
    { name: 123, quantity: 2 },
    { name: 'Aquarium', quantity: '2' },
    { name: 'Aquarium', quantity: 0 },
    { name: 'Aquarium', quantity: 101 },
    { name: 'Aquarium', quantity: 1.5 },
    { name: 'Aquarium' },
    { name: 'Aquarium', quantity: 2, admin: true },
    {}, [],
  ])('rejects malformed or unknown fields (%#)', async (body) => {
    await request(app.getHttpServer()).post('/api/v1/http-test/items')
      .send(body).expect(400)
      .expect({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' } });
  });

  it('normalizes malformed JSON errors', async () => {
    await request(app.getHttpServer()).post('/api/v1/http-test/items')
      .set('Content-Type', 'application/json').send('{"name":')
      .expect(400)
      .expect({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed' } });
  });

  it.each(['/unimplemented', '/api/v1/unimplemented', '/http-test/items'])(
    'returns a consistent 404 for %s', async (path) => {
      await request(app.getHttpServer()).get(path).expect(404)
        .expect({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    },
  );

  it.each([
    [400, 'VALIDATION_ERROR', 'Request validation failed'],
    [401, 'UNAUTHORIZED', 'Authentication required'],
    [403, 'FORBIDDEN', 'Access denied'],
    [404, 'NOT_FOUND', 'Resource not found'],
    [409, 'CONFLICT', 'Request conflicts with the current state'],
    [429, 'RATE_LIMITED', 'Too many requests'],
    [503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable'],
    [500, 'INTERNAL_ERROR', 'An unexpected error occurred'],
    [502, 'INTERNAL_ERROR', 'An unexpected error occurred'],
    [418, 'HTTP_ERROR', 'Request failed'],
  ])('maps HTTP %s without exposing exception content', async (status, code, message) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/http-test/status/${status}`).expect(Number(status));
    expect(response.body).toEqual({ error: { code, message } });
    expect(response.text).not.toContain('private-');
    expect(response.text).not.toContain('stack');
  });

  it('keeps unexpected production errors generic', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/http-test/internal').expect(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(response.text).not.toContain('private-');
    expect(response.text).not.toContain('Database');
    expect(response.text).not.toContain('stack');
  });

  it('enables CORS only for the configured explicit origin, without credentials', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/unimplemented')
      .set('Origin', 'https://aquaku.example.com').expect(404);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not authorize an arbitrary origin', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/unimplemented')
      .set('Origin', 'https://untrusted.example.com').expect(404);
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-origin']).not.toBe('https://untrusted.example.com');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
