export type AppEnvironment = 'development' | 'test' | 'production';

export interface RuntimeConfig {
  readonly appEnv: AppEnvironment;
  readonly port: number;
  readonly apiPrefix: string;
  readonly databaseUrl: string;
  readonly corsOrigin?: string;
}

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

export class ConfigValidationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid configuration fields: ${fields.join(', ')}`);
    this.name = 'ConfigValidationError';
  }
}

function validDatabaseUrl(value: string): boolean {
  if (value.length > 4096 || /[\s\\\p{Cc}]/u.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.slice(1));
    // PostgreSQL URLs have opaque hosts in WHATWG; also validate as an HTTP host.
    const host = new URL(`http://${url.host}`);
    // Reject malformed escapes even in credentials and connection options.
    decodeURIComponent(value);
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      Boolean(url.hostname) && Boolean(host.hostname) &&
      (!url.port || (/^[0-9]+$/.test(url.port) && Number(url.port) >= 1 && Number(url.port) <= 65535)) &&
      !value.includes('#') &&
      Boolean(database.trim()) &&
      Buffer.byteLength(database, 'utf8') <= 63 &&
      !/[/\\\p{Cc}]/u.test(database)
    );
  } catch {
    return false;
  }
}

function parseCorsOrigin(value: string): string | undefined {
  if (
    value.length > 2048 || /[\s\\*\p{Cc}]/u.test(value) ||
    !/^https?:\/\/[^/?#]+\/?$/i.test(value)
  ) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      (url.port && Number(url.port) < 1)
    ) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function validateConfig(env: NodeJS.ProcessEnv): Readonly<RuntimeConfig> {
  const fields: string[] = [];
  const appEnv = env.APP_ENV ?? 'development';
  const port = env.PORT ?? '3000';
  const apiPrefix = env.API_PREFIX ?? '/api/v1';
  const databaseUrl = env.DATABASE_URL ?? '';
  const corsOrigin = env.CORS_ORIGIN === undefined
    ? undefined
    : parseCorsOrigin(env.CORS_ORIGIN);

  if (!['development', 'test', 'production'].includes(appEnv)) fields.push('APP_ENV');
  if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) fields.push('PORT');
  if (apiPrefix.length > 128 || !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(apiPrefix)) {
    fields.push('API_PREFIX');
  }
  if (!validDatabaseUrl(databaseUrl)) fields.push('DATABASE_URL');
  if (env.CORS_ORIGIN !== undefined && corsOrigin === undefined) fields.push('CORS_ORIGIN');
  if (fields.length) throw new ConfigValidationError(Object.freeze(fields));

  return Object.freeze({
    appEnv: appEnv as AppEnvironment,
    port: Number(port),
    apiPrefix,
    databaseUrl,
    ...(corsOrigin === undefined ? {} : { corsOrigin }),
  });
}
