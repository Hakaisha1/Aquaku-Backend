import { BadRequestException, ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RuntimeConfig } from '../config/runtime-config';
import { AuthService } from './auth.service';
import {
  otpDigest,
  REFRESH_TOKEN_TTL_SECONDS,
  signToken,
  tokenDigest,
} from './auth-security';
import { hashPassword } from './password-hasher';
import { FakeOtpSender } from './otp-sender';

const now = new Date('2026-11-09T12:00:00.000Z');
const secrets = { jwtAccessSecret: 'a'.repeat(48), jwtRefreshSecret: 'b'.repeat(48) };
const userRow = {
  id: 'e7b8c921-82e2-4967-8ab4-d732c5815d18',
  email: 'user@example.com',
  phoneNumber: '+6281234567890',
  passwordHash: '',
  displayName: 'Aquaku User',
  avatarUrl: null,
  whatsappNumber: null,
  bio: null,
  phoneVerifiedAt: null,
  tier: 'PERSONAL',
  tierExpiresAt: null,
  verifiedStore: false,
  role: 'MEMBER',
  createdAt: now,
  updatedAt: now,
};

function createHarness(appEnv: RuntimeConfig['appEnv'] = 'test') {
  const tx = {
    user: { create: jest.fn(), update: jest.fn() },
    otpChallenge: { create: jest.fn(), deleteMany: jest.fn() },
    refreshToken: { create: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(tx as unknown as Prisma.TransactionClient)),
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    otpChallenge: { findUnique: jest.fn(), updateMany: jest.fn() },
    refreshToken: { findUnique: jest.fn(), create: jest.fn() },
  };
  const config = {
    appEnv,
    port: 3000,
    apiPrefix: '/api/v1',
    databaseUrl: 'postgresql://localhost/aquaku_test',
    ...secrets,
  } as RuntimeConfig;
  const sender = new FakeOtpSender();
  const service = new AuthService(prisma as unknown as PrismaService, config, sender);
  return { service, prisma, tx, sender };
}

describe('AuthService', () => {
  it('registers with normalized identities, a password hash, and development-only OTP delivery', async () => {
    const { service, tx, sender } = createHarness();
    tx.user.create.mockResolvedValue({ ...userRow, email: 'person@example.com' });
    tx.otpChallenge.create.mockResolvedValue({});

    const result = await service.register({
      email: ' Person@Example.com ',
      password: 'correct horse battery staple',
      display_name: ' Person ',
      phone_number: '0812 3456 7890',
    });

    const createArgs = tx.user.create.mock.calls[0][0] as {
      data: { email: string; phoneNumber: string; passwordHash: string; displayName: string };
    };
    expect(createArgs.data.email).toBe('person@example.com');
    expect(createArgs.data.phoneNumber).toBe('+6281234567890');
    expect(createArgs.data.displayName).toBe('Person');
    expect(createArgs.data.passwordHash).not.toContain('correct horse battery staple');
    expect(result.development_otp).toMatch(/^\d{6}$/);
    expect(sender.sent).toEqual([{ phoneNumber: '+6281234567890', code: result.development_otp }]);
  });

  it('does not allow the local OTP channel in production', async () => {
    const { service, prisma } = createHarness('production');
    await expect(service.register({
      email: 'person@example.com',
      password: 'correct horse battery staple',
      display_name: 'Person',
      phone_number: '081234567890',
    })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('maps duplicate unique values to a conflict without exposing database details', async () => {
    const { service, tx } = createHarness();
    tx.user.create.mockRejectedValue({ code: 'P2002', meta: { target: ['email'] } });
    await expect(service.register({
      email: 'person@example.com',
      password: 'correct horse battery staple',
      display_name: 'Person',
      phone_number: '081234567890',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('issues JWT access and refresh tokens after a valid login', async () => {
    const { service, prisma } = createHarness();
    const passwordHash = await hashPassword('correct horse battery staple');
    prisma.user.findUnique.mockResolvedValue({ ...userRow, passwordHash });
    prisma.refreshToken.create.mockResolvedValue({});

    const result = await service.login({
      email: ' USER@EXAMPLE.COM ',
      password: 'correct horse battery staple',
    });

    expect(result.access_token.split('.')).toHaveLength(3);
    expect(result.refresh_token.split('.')).toHaveLength(3);
    expect(result.expires_in).toBe(900);
    expect(result.user.id).toBe(userRow.id);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: userRow.id }),
    }));
  });

  it('does not authenticate a user with an incorrect password', async () => {
    const { service, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue({ ...userRow, passwordHash: 'malformed' });
    await expect(service.login({ email: 'user@example.com', password: 'incorrect' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rotates refresh tokens and rejects a token that has already been consumed', async () => {
    const { service, prisma, tx } = createHarness();
    const tokenId = '68446254-0f32-4dd5-84e8-cf8a72239457';
    const refreshToken = signToken(
      userRow.id,
      'refresh',
      secrets.jwtRefreshSecret,
      REFRESH_TOKEN_TTL_SECONDS,
      Math.floor(Date.now() / 1000),
      tokenId,
    );
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: tokenId,
      userId: userRow.id,
      tokenHash: tokenDigest(refreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: userRow,
    });
    tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    tx.refreshToken.create.mockResolvedValue({});

    const result = await service.refresh(refreshToken);
    expect(result.refresh_token).not.toBe(refreshToken);
    expect(result.access_token.split('.')).toHaveLength(3);
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: tokenId, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
    }));

    tx.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('counts invalid OTP attempts and rejects incorrect codes', async () => {
    const { service, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue(userRow);
    prisma.otpChallenge.findUnique.mockResolvedValue({
      id: '4c4394e6-2dab-4020-8bd0-077755046711',
      userId: userRow.id,
      codeHash: otpDigest(userRow.id, '123456', secrets.jwtRefreshSecret),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      lastSentAt: now,
    });
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.verifyPhone(userRow.id, '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { attempts: { increment: 1 } },
    }));
  });

  it('marks the phone verified only after consuming a valid OTP', async () => {
    const { service, prisma, tx } = createHarness();
    prisma.user.findUnique.mockResolvedValue(userRow);
    prisma.otpChallenge.findUnique.mockResolvedValue({
      id: '4c4394e6-2dab-4020-8bd0-077755046711',
      userId: userRow.id,
      codeHash: otpDigest(userRow.id, '123456', secrets.jwtRefreshSecret),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      lastSentAt: now,
    });
    tx.otpChallenge.deleteMany.mockResolvedValue({ count: 1 });
    tx.user.update.mockResolvedValue({ ...userRow, phoneVerifiedAt: now });

    await expect(service.verifyPhone(userRow.id, '123456'))
      .resolves.toMatchObject({ phone_verified: true });
  });

  it('locks OTP verification after the maximum number of attempts', async () => {
    const { service, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue(userRow);
    prisma.otpChallenge.findUnique.mockResolvedValue({
      id: '4c4394e6-2dab-4020-8bd0-077755046711',
      userId: userRow.id,
      codeHash: otpDigest(userRow.id, '123456', secrets.jwtRefreshSecret),
      attempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      lastSentAt: now,
    });
    await expect(service.verifyPhone(userRow.id, '123456'))
      .rejects.toMatchObject({ status: 429 });
  });

  it('enforces the OTP resend delay', async () => {
    const { service, prisma } = createHarness();
    prisma.user.findUnique.mockResolvedValue(userRow);
    prisma.otpChallenge.findUnique.mockResolvedValue({
      id: '4c4394e6-2dab-4020-8bd0-077755046711',
      userId: userRow.id,
      codeHash: otpDigest(userRow.id, '123456', secrets.jwtRefreshSecret),
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000),
      lastSentAt: new Date(),
    });
    await expect(service.resendOtp(userRow.id)).rejects.toBeInstanceOf(HttpException);
    expect(prisma.otpChallenge.updateMany).not.toHaveBeenCalled();
  });
});
