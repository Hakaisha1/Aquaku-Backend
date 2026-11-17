import { randomBytes } from 'node:crypto';

export type AppEnvironment = 'development' | 'test' | 'production';

export interface RuntimeConfig {
  readonly appEnv: AppEnvironment;
  readonly port: number;
  readonly apiPrefix: string;
  readonly databaseUrl: string;
  readonly mongoUri: string;
  readonly jwtAccessSecret: string;
  readonly jwtRefreshSecret: string;
  readonly corsOrigin?: string | string[];
  readonly cloudinaryCloudName?: string;
  readonly cloudinaryApiKey?: string;
  readonly cloudinaryApiSecret?: string;
  readonly cloudinaryUploadPreset?: string;
  readonly otpIdApiKey?: string;
}

export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');

const developmentAccessSecret = randomBytes(32).toString('base64url');
const developmentRefreshSecret = randomBytes(32).toString('base64url');

export class ConfigValidationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid configuration fields: ${fields.join(', ')}`);
    this.name = 'ConfigValidationError';
  }
}

function validDatabaseUrl(value: string, appEnv: string = 'development'): boolean {
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
    const isValid = (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      Boolean(url.hostname) && Boolean(host.hostname) &&
      (!url.port || (/^[0-9]+$/.test(url.port) && Number(url.port) >= 1 && Number(url.port) <= 65535)) &&
      !value.includes('#') &&
      Boolean(database.trim()) &&
      Buffer.byteLength(database, 'utf8') <= 63 &&
      !/[/\\\p{Cc}]/u.test(database)
    );
    if (!isValid) return false;

    if (appEnv === 'production') {
      const sslmode = url.searchParams.get('sslmode')?.toLowerCase();
      const ssl = url.searchParams.get('ssl')?.toLowerCase();
      const isSecure = sslmode === 'require' || sslmode === 'verify-full' || sslmode === 'verify-ca' || ssl === 'true';
      if (!isSecure) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function parseCloudinaryUrl(value: string): {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
} | undefined {
  if (value.length > 2048 || /[\s\\\p{Cc}]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'cloudinary:' || !url.hostname || !url.username || !url.password ||
      (url.pathname !== '' && url.pathname !== '/') || url.search || url.hash || url.port
    ) return undefined;
    return {
      cloudName: url.hostname,
      apiKey: decodeURIComponent(url.username),
      apiSecret: decodeURIComponent(url.password),
    };
  } catch {
    return undefined;
  }
}

function validMongoUrl(value: string, appEnv: string = 'development'): boolean {
  if (value.length > 4096 || /[\s\\\p{Cc}]/u.test(value)) return false;
  try {
    const url = new URL(value);
    decodeURIComponent(value);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    const isValid = (
      (url.protocol === 'mongodb:' || url.protocol === 'mongodb+srv:') &&
      Boolean(url.hostname) && (!databaseName || !databaseName.includes('/')) &&
      !url.hash && (url.protocol !== 'mongodb+srv:' || !url.port)
    );
    if (!isValid) return false;

    if (appEnv === 'production') {
      const isSrv = url.protocol === 'mongodb+srv:';
      const tls = url.searchParams.get('tls')?.toLowerCase();
      const ssl = url.searchParams.get('ssl')?.toLowerCase();
      const isSecure = isSrv || tls === 'true' || ssl === 'true';
      if (!isSecure) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function parseCorsOrigin(value: string, appEnv: string = 'development'): string | string[] | undefined {
  if (value.length > 4096 || value.startsWith(' ') || value.endsWith(' ')) return undefined;
  const rawParts = value.split(',').map((p) => p.trim()).filter(Boolean);
  if (rawParts.length === 0) return undefined;

  const validOrigins: string[] = [];
  for (const part of rawParts) {
    if (
      part.length > 2048 || /[\s\\*\p{Cc}]/u.test(part) ||
      !/^https?:\/\/[^/?#]+\/?$/i.test(part)
    ) return undefined;

    try {
      const url = new URL(part);
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        !url.hostname || url.username || url.password ||
        (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash ||
        (url.port && Number(url.port) < 1)
      ) return undefined;

      if (appEnv === 'production' && url.protocol !== 'https:') {
        return undefined;
      }

      validOrigins.push(url.origin);
    } catch {
      return undefined;
    }
  }

  return validOrigins.length === 1 ? validOrigins[0] : validOrigins;
}

export function validateConfig(env: NodeJS.ProcessEnv): Readonly<RuntimeConfig> {
  const fields: string[] = [];
  const appEnv = env.APP_ENV ?? 'development';
  const port = env.PORT ?? '3000';
  const apiPrefix = env.API_PREFIX ?? '/api/v1';
  const databaseUrl = env.DATABASE_URL ?? '';
  const mongoUri = env.MONGODB_URI ?? (appEnv === 'production' ? '' : 'mongodb://127.0.0.1:27017/aquaku');
  const jwtAccessSecret = env.JWT_ACCESS_SECRET ||
    (appEnv === 'production' ? '' : developmentAccessSecret);
  const jwtRefreshSecret = env.JWT_REFRESH_SECRET ||
    (appEnv === 'production' ? '' : developmentRefreshSecret);
  const corsOrigin = env.CORS_ORIGIN === undefined
    ? undefined
    : parseCorsOrigin(env.CORS_ORIGIN, appEnv);
  const cloudinaryUrl = env.CLOUDINARY_URL;
  const hasCloudinaryUrl = cloudinaryUrl !== undefined && cloudinaryUrl !== '';
  const individualCloudinaryValues = [
    env.CLOUDINARY_CLOUD_NAME,
    env.CLOUDINARY_API_KEY,
    env.CLOUDINARY_API_SECRET,
  ];
  const hasIndividualCloudinaryValues = individualCloudinaryValues.some((value) => value !== undefined && value !== '');
  const parsedCloudinaryUrl = hasCloudinaryUrl ? parseCloudinaryUrl(cloudinaryUrl) : undefined;
  const cloudinaryCloudName = parsedCloudinaryUrl?.cloudName ?? env.CLOUDINARY_CLOUD_NAME;
  const cloudinaryApiKey = parsedCloudinaryUrl?.apiKey ?? env.CLOUDINARY_API_KEY;
  const cloudinaryApiSecret = parsedCloudinaryUrl?.apiSecret ?? env.CLOUDINARY_API_SECRET;
  const cloudinaryUploadPreset = env.CLOUDINARY_UPLOAD_PRESET;
  const cloudinaryConfigured = hasCloudinaryUrl || hasIndividualCloudinaryValues ||
    (cloudinaryUploadPreset !== undefined && cloudinaryUploadPreset !== '');
  const otpIdApiKey = env.OTP_ID_API_KEY;

  if (!['development', 'test', 'production'].includes(appEnv)) fields.push('APP_ENV');
  if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) fields.push('PORT');
  if (apiPrefix.length > 128 || !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(apiPrefix)) {
    fields.push('API_PREFIX');
  }
  if (!validDatabaseUrl(databaseUrl, appEnv)) fields.push('DATABASE_URL');
  if (!validMongoUrl(mongoUri, appEnv)) fields.push('MONGODB_URI');
  if (jwtAccessSecret.length < 32) fields.push('JWT_ACCESS_SECRET');
  if (jwtRefreshSecret.length < 32) fields.push('JWT_REFRESH_SECRET');
  if (jwtAccessSecret && jwtAccessSecret === jwtRefreshSecret) fields.push('JWT_REFRESH_SECRET');
  if (env.CORS_ORIGIN !== undefined && corsOrigin === undefined) fields.push('CORS_ORIGIN');
  if (appEnv === 'production' && !otpIdApiKey) fields.push('OTP_ID_API_KEY');
  if (otpIdApiKey && !/^[a-zA-Z0-9-]{16,128}$/.test(otpIdApiKey)) fields.push('OTP_ID_API_KEY');
  if (cloudinaryConfigured) {
    if (hasCloudinaryUrl && (!parsedCloudinaryUrl || hasIndividualCloudinaryValues)) {
      fields.push('CLOUDINARY_URL');
    }
    if (!hasCloudinaryUrl || parsedCloudinaryUrl) {
      if (!cloudinaryCloudName || !/^[a-zA-Z0-9_-]{1,128}$/.test(cloudinaryCloudName)) {
        fields.push('CLOUDINARY_CLOUD_NAME');
      }
      if (!cloudinaryApiKey || !/^[a-zA-Z0-9_-]{1,128}$/.test(cloudinaryApiKey)) {
        fields.push('CLOUDINARY_API_KEY');
      }
      if (!cloudinaryApiSecret || cloudinaryApiSecret.length < 16 || cloudinaryApiSecret.length > 512 || /[\s\p{Cc}]/u.test(cloudinaryApiSecret)) {
        fields.push('CLOUDINARY_API_SECRET');
      }
    }
    if (!cloudinaryUploadPreset || !/^[a-zA-Z0-9_-]{1,128}$/.test(cloudinaryUploadPreset)) {
      fields.push('CLOUDINARY_UPLOAD_PRESET');
    }
  }
  if (fields.length) throw new ConfigValidationError(Object.freeze(fields));

  return Object.freeze({
    appEnv: appEnv as AppEnvironment,
    port: Number(port),
    apiPrefix,
    databaseUrl,
    mongoUri,
    jwtAccessSecret,
    jwtRefreshSecret,
    ...(corsOrigin === undefined ? {} : { corsOrigin }),
    ...(cloudinaryConfigured ? {
      cloudinaryCloudName,
      cloudinaryApiKey,
      cloudinaryApiSecret,
      cloudinaryUploadPreset,
    } : {}),
    ...(otpIdApiKey ? { otpIdApiKey } : {}),
  });
}
