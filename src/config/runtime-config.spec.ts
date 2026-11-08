import { ConfigValidationError, validateConfig } from './runtime-config';

const databaseUrl = 'postgresql://aquaku:secret@localhost:5432/aquaku';
const base = { DATABASE_URL: databaseUrl };

describe('validateConfig', () => {
  it('uses defaults without requiring JWT configuration', () => {
    const config = validateConfig(base);
    expect(config).toEqual({
      appEnv: 'development', port: 3000, apiPrefix: '/api/v1', databaseUrl,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('accepts explicit configuration and normalizes an origin', () => {
    expect(validateConfig({
      APP_ENV: 'production', PORT: '65535', API_PREFIX: '/service/v2',
      DATABASE_URL: 'postgres://user:pass@[::1]:5432/aquaku?sslmode=require',
      CORS_ORIGIN: 'https://example.com:443/',
    })).toEqual({
      appEnv: 'production', port: 65535, apiPrefix: '/service/v2',
      databaseUrl: 'postgres://user:pass@[::1]:5432/aquaku?sslmode=require',
      corsOrigin: 'https://example.com',
    });
  });

  it.each(['development', 'test', 'production'])('accepts APP_ENV %s', (APP_ENV) => {
    expect(validateConfig({ ...base, APP_ENV }).appEnv).toBe(APP_ENV);
  });

  it.each(['1', '3000', '65535'])('accepts PORT %s', (PORT) => {
    expect(validateConfig({ ...base, PORT }).port).toBe(Number(PORT));
  });

  it.each([
    'postgres://localhost/aquaku',
    'postgresql://localhost:5432/aquaku?sslmode=require&connect_timeout=10',
    'postgresql://user:p%40ss@db.example.com/aquaku',
  ])('accepts a PostgreSQL connection URL (%#)', (DATABASE_URL) => {
    expect(validateConfig({ DATABASE_URL }).databaseUrl).toBe(DATABASE_URL);
  });

  it.each([
    ['APP_ENV', ''], ['APP_ENV', 'staging'], ['APP_ENV', 'Production'],
    ['PORT', ''], ['PORT', '0'], ['PORT', '-1'], ['PORT', '65536'],
    ['PORT', '3000.0'], ['PORT', '3e3'], ['PORT', '3000abc'],
    ['PORT', ' 3000'], ['PORT', '3000 '], ['PORT', '+3000'], ['PORT', '0xBB8'],
    ['API_PREFIX', ''], ['API_PREFIX', '/'], ['API_PREFIX', 'api/v1'],
    ['API_PREFIX', '/api/v1/'], ['API_PREFIX', '//api/v1'],
    ['API_PREFIX', '/api/../v1'], ['API_PREFIX', '/api?debug=true'],
    ['API_PREFIX', '/api/#fragment'], ['API_PREFIX', '/api/%2f'],
    ['API_PREFIX', '/api/*'], ['API_PREFIX', '/api/with space'],
    ['API_PREFIX', `/${'a'.repeat(128)}`],
    ['DATABASE_URL', undefined], ['DATABASE_URL', ''],
    ['DATABASE_URL', 'https://localhost/aquaku'],
    ['DATABASE_URL', 'mysql://localhost/aquaku'],
    ['DATABASE_URL', 'file:///aquaku'],
    ['DATABASE_URL', 'postgresql:///aquaku'],
    ['DATABASE_URL', 'postgresql://localhost'],
    ['DATABASE_URL', 'postgresql://localhost/'],
    ['DATABASE_URL', 'postgresql://localhost/db/other'],
    ['DATABASE_URL', 'postgresql://localhost/db%2fother'],
    ['DATABASE_URL', 'postgresql://localhost/db%00'],
    ['DATABASE_URL', 'postgresql://localhost/%20'],
    ['DATABASE_URL', 'postgresql://localhost/db%ZZ'],
    ['DATABASE_URL', 'postgresql://%2f/aquaku'],
    ['DATABASE_URL', 'postgresql://localhost/aquaku#'],
    ['DATABASE_URL', 'postgresql://localhost:0/aquaku'],
    ['DATABASE_URL', 'postgresql://localhost:65536/aquaku'],
    ['DATABASE_URL', 'postgresql://localhost:abc/aquaku'],
    ['DATABASE_URL', 'postgresql://localhost/aquaku#fragment'],
    ['DATABASE_URL', ' postgresql://localhost/aquaku'],
    ['DATABASE_URL', 'postgresql://localhost/aqua\nku'],
    ['DATABASE_URL', `postgresql://localhost/${'a'.repeat(64)}`],
    ['DATABASE_URL', `postgresql://user:${'s'.repeat(4096)}@localhost/db`],
    ['CORS_ORIGIN', ''], ['CORS_ORIGIN', '*'],
    ['CORS_ORIGIN', 'https://*.example.com'],
    ['CORS_ORIGIN', 'null'], ['CORS_ORIGIN', 'file:///tmp'],
    ['CORS_ORIGIN', 'ftp://example.com'], ['CORS_ORIGIN', '//example.com'],
    ['CORS_ORIGIN', 'https://user:password@example.com'],
    ['CORS_ORIGIN', 'https://example.com/path'],
    ['CORS_ORIGIN', 'https:example.com'],
    ['CORS_ORIGIN', 'https:///example.com'],
    ['CORS_ORIGIN', 'https://example.com/path/..'],
    ['CORS_ORIGIN', 'https://example.com?'],
    ['CORS_ORIGIN', 'https://example.com#'],
    ['CORS_ORIGIN', 'https://example.com?query=true'],
    ['CORS_ORIGIN', 'https://example.com#fragment'],
    ['CORS_ORIGIN', 'https://example.com,https://other.example.com'],
    ['CORS_ORIGIN', ' https://example.com'],
    ['CORS_ORIGIN', 'http://localhost:0'],
    ['CORS_ORIGIN', 'http://localhost:65536'],
  ])('rejects invalid %s (%#)', (field, value) => {
    expect(() => validateConfig({ ...base, [field as string]: value }))
      .toThrow(`Invalid configuration fields: ${field}`);
  });

  it.each(['http://localhost:5173', 'https://example.com'])('accepts CORS_ORIGIN %s', (CORS_ORIGIN) => {
    expect(validateConfig({ ...base, CORS_ORIGIN }).corsOrigin).toBe(CORS_ORIGIN);
  });

  it('reports all invalid fields without including values or secrets', () => {
    try {
      validateConfig({
        APP_ENV: 'private-environment', PORT: 'private-port', API_PREFIX: 'private-prefix',
        DATABASE_URL: 'mysql://private-user:private-password@private-host/private-db',
        CORS_ORIGIN: 'https://private-user:private-password@private-host/path',
      });
      throw new Error('Expected configuration validation to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const failure = error as ConfigValidationError;
      expect(failure.fields).toEqual(['APP_ENV', 'PORT', 'API_PREFIX', 'DATABASE_URL', 'CORS_ORIGIN']);
      expect(failure.message).toBe('Invalid configuration fields: APP_ENV, PORT, API_PREFIX, DATABASE_URL, CORS_ORIGIN');
      expect(`${failure.stack}${JSON.stringify(failure)}`).not.toContain('private-');
    }
  });
});
