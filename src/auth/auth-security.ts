import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OTP_TTL_MILLISECONDS = 5 * 60 * 1000;
export const OTP_RESEND_DELAY_MILLISECONDS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export interface TokenClaims {
  readonly sub: string;
  readonly jti: string;
  readonly typ: 'access' | 'refresh';
  readonly iat: number;
  readonly exp: number;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signToken(
  subject: string,
  type: TokenClaims['typ'],
  secret: string,
  lifetimeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
  tokenId = randomBytes(16).toString('hex'),
): string {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: subject,
    jti: tokenId,
    typ: type,
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
  } satisfies TokenClaims);
  const content = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

export function verifyToken(
  token: string,
  type: TokenClaims['typ'],
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TokenClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined;

  const [headerPart, payloadPart, signaturePart] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  let header: unknown;
  let claims: unknown;
  try {
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as unknown;
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }

  if (!header || typeof header !== 'object' || (header as { alg?: unknown }).alg !== 'HS256') {
    return undefined;
  }
  if (!claims || typeof claims !== 'object') return undefined;
  const value = claims as Partial<TokenClaims>;
  if (
    typeof value.sub !== 'string' || typeof value.jti !== 'string' ||
    value.typ !== type || !Number.isInteger(value.iat) || !Number.isInteger(value.exp) ||
    (value.exp as number) <= nowSeconds || (value.iat as number) > nowSeconds + 60
  ) return undefined;
  return value as TokenClaims;
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function otpDigest(userId: string, code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`aquaku:phone-otp:${userId}:${code}`).digest('hex');
}

export function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
