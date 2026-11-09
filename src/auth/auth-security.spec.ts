import {
  ACCESS_TOKEN_TTL_SECONDS,
  createOtpCode,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_DELAY_MILLISECONDS,
  OTP_TTL_MILLISECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  signToken,
  verifyToken,
} from './auth-security';
import { hashPassword, verifyPassword } from './password-hasher';
import { normalizeIndonesianPhone } from './auth.service';

describe('account security helpers', () => {
  const secret = 's'.repeat(48);

  it('signs and verifies access and refresh tokens with separate token types', () => {
    const access = signToken('user-id', 'access', secret, ACCESS_TOKEN_TTL_SECONDS, 1000);
    expect(verifyToken(access, 'access', secret, 1001)).toMatchObject({
      sub: 'user-id', typ: 'access', iat: 1000, exp: 1000 + ACCESS_TOKEN_TTL_SECONDS,
    });
    expect(verifyToken(access, 'refresh', secret)).toBeUndefined();
    expect(verifyToken(access, 'access', `${secret}x`)).toBeUndefined();
    expect(verifyToken(`${access}x`, 'access', secret)).toBeUndefined();
  });

  it('rejects expired tokens', () => {
    const token = signToken('user-id', 'refresh', secret, REFRESH_TOKEN_TTL_SECONDS, 1000);
    expect(verifyToken(token, 'refresh', secret, 1000 + REFRESH_TOKEN_TTL_SECONDS)).toBeUndefined();
  });

  it('generates six-digit OTPs and applies the documented limits', () => {
    expect(createOtpCode()).toMatch(/^\d{6}$/);
    expect(OTP_TTL_MILLISECONDS).toBe(5 * 60 * 1000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_RESEND_DELAY_MILLISECONDS).toBe(60 * 1000);
  });

  it.each([
    ['081234567890', '+6281234567890'],
    ['62 812-3456-7890', '+6281234567890'],
    ['+62 (812) 3456 7890', '+6281234567890'],
  ])('normalizes Indonesian phone %s', (input, expected) => {
    expect(normalizeIndonesianPhone(input)).toBe(expected);
  });

  it.each(['81234567890', '+14155552671', '0812abc', '0812'])('rejects invalid phone %s', (input) => {
    expect(() => normalizeIndonesianPhone(input)).toThrow();
  });

  it('hashes passwords with a per-password salt and verifies without exposing the original', async () => {
    const password = 'correct horse battery staple';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword('incorrect password', first)).resolves.toBe(false);
    await expect(verifyPassword(password, 'malformed')).resolves.toBe(false);
  });
});
