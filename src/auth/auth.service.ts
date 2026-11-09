import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { LoginDto, RegisterDto } from './auth.dto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  constantTimeTextEqual,
  createOtpCode,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_DELAY_MILLISECONDS,
  OTP_TTL_MILLISECONDS,
  otpDigest,
  REFRESH_TOKEN_TTL_SECONDS,
  signToken,
  tokenDigest,
  verifyToken,
} from './auth-security';
import { hashPassword, verifyPassword } from './password-hasher';
import { OTP_SENDER, OtpSender } from './otp-sender';

const userSelection = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  phoneVerifiedAt: true,
  tier: true,
  tierExpiresAt: true,
  verifiedStore: true,
  role: true,
  createdAt: true,
} as const;

export interface AuthenticatedUser {
  readonly id: string;
  readonly role: 'member' | 'admin';
  readonly phoneVerified: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  phone_verified: boolean;
  tier: string;
  tier_expires_at: Date | null;
  verified_store: boolean;
  role: 'member' | 'admin';
  created_at: Date;
}

export interface RegistrationResult {
  readonly user: UserProfile;
  readonly development_otp?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    @Inject(OTP_SENDER) private readonly otpSender: OtpSender,
  ) {}

  async register(input: RegisterDto): Promise<RegistrationResult> {
    this.assertLocalOtpAllowed();
    const email = input.email.trim().toLowerCase();
    const phoneNumber = normalizeIndonesianPhone(input.phone_number);
    const displayName = input.display_name.trim();
    if (!displayName) throw new BadRequestException();

    const code = createOtpCode();
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email, phoneNumber, passwordHash, displayName },
          select: userSelection,
        });
        await tx.otpChallenge.create({
          data: {
            userId: created.id,
            codeHash: this.hashOtp(created.id, code),
            expiresAt: new Date(Date.now() + OTP_TTL_MILLISECONDS),
            lastSentAt: new Date(),
          },
        });
        return created;
      });
      await this.otpSender.send(phoneNumber, code);
      return {
        user: this.toUserProfile(user),
        ...(this.config.appEnv === 'development' || this.config.appEnv === 'test'
          ? { development_otp: code }
          : {}),
      };
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new ConflictException();
      throw error;
    }
  }

  async login(input: LoginDto) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException();
    }
    const tokens = await this.issueTokenPair(user.id);
    return { ...tokens, user: this.toUserProfile(user) };
  }

  async refresh(refreshToken: string) {
    const claims = verifyToken(refreshToken, 'refresh', this.config.jwtRefreshSecret);
    if (!claims) throw new UnauthorizedException();

    const now = new Date();
    const tokenHash = tokenDigest(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { id: claims.jti },
      include: { user: { select: userSelection } },
    });
    if (
      !existing || existing.userId !== claims.sub || existing.revokedAt ||
      existing.expiresAt <= now || !constantTimeTextEqual(existing.tokenHash, tokenHash)
    ) throw new UnauthorizedException();

    const nextTokenId = randomUUID();
    const nextRefreshToken = signToken(
      existing.userId,
      'refresh',
      this.config.jwtRefreshSecret,
      REFRESH_TOKEN_TTL_SECONDS,
      Math.floor(now.getTime() / 1000),
      nextTokenId,
    );
    const nextExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const accessToken = signToken(
      existing.userId,
      'access',
      this.config.jwtAccessSecret,
      ACCESS_TOKEN_TTL_SECONDS,
      Math.floor(now.getTime() / 1000),
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const revoked = await tx.refreshToken.updateMany({
          where: { id: existing.id, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now },
        });
        if (revoked.count !== 1) throw new UnauthorizedException();
        await tx.refreshToken.create({
          data: {
            id: nextTokenId,
            userId: existing.userId,
            tokenHash: tokenDigest(nextRefreshToken),
            expiresAt: nextExpiresAt,
          },
        });
      });
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException();
    }

    return {
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      user: this.toUserProfile(existing.user),
    };
  }

  async verifyPhone(userId: string, code: string): Promise<UserProfile> {
    this.assertLocalOtpAllowed();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: userSelection });
    if (!user) throw new UnauthorizedException();
    if (user.phoneVerifiedAt) return this.toUserProfile(user);

    const challenge = await this.prisma.otpChallenge.findUnique({ where: { userId } });
    const now = new Date();
    if (!challenge || challenge.expiresAt <= now) throw new BadRequestException();
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new HttpException('Too many requests', 429);

    if (!constantTimeTextEqual(this.hashOtp(userId, code), challenge.codeHash)) {
      const updated = await this.prisma.otpChallenge.updateMany({
        where: { id: challenge.id, attempts: { lt: OTP_MAX_ATTEMPTS }, expiresAt: { gt: now } },
        data: { attempts: { increment: 1 } },
      });
      if (updated.count !== 1) throw new HttpException('Too many requests', 429);
      throw new BadRequestException();
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.otpChallenge.deleteMany({
          where: {
            id: challenge.id,
            codeHash: challenge.codeHash,
            attempts: { lt: OTP_MAX_ATTEMPTS },
            expiresAt: { gt: now },
          },
        });
        if (consumed.count !== 1) throw new BadRequestException();
        const verified = await tx.user.update({
          where: { id: userId },
          data: { phoneVerifiedAt: now },
          select: userSelection,
        });
        return this.toUserProfile(verified);
      });
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException();
    }
  }

  async resendOtp(userId: string): Promise<{ development_otp?: string }> {
    this.assertLocalOtpAllowed();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.phoneVerifiedAt) throw new BadRequestException();

    const code = createOtpCode();
    const now = new Date();
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { userId } });
    if (challenge) {
      const allowedAfter = challenge.lastSentAt.getTime() + OTP_RESEND_DELAY_MILLISECONDS;
      if (now.getTime() < allowedAfter) throw new HttpException('Too many requests', 429);
      const changed = await this.prisma.otpChallenge.updateMany({
        where: { id: challenge.id, lastSentAt: challenge.lastSentAt },
        data: {
          codeHash: this.hashOtp(userId, code),
          attempts: 0,
          expiresAt: new Date(now.getTime() + OTP_TTL_MILLISECONDS),
          lastSentAt: now,
        },
      });
      if (changed.count !== 1) throw new HttpException('Too many requests', 429);
    } else {
      try {
        await this.prisma.otpChallenge.create({
          data: {
            userId,
            codeHash: this.hashOtp(userId, code),
            expiresAt: new Date(now.getTime() + OTP_TTL_MILLISECONDS),
            lastSentAt: now,
          },
        });
      } catch {
        throw new HttpException('Too many requests', 429);
      }
    }
    await this.otpSender.send(user.phoneNumber, code);
    return this.config.appEnv === 'development' || this.config.appEnv === 'test'
      ? { development_otp: code }
      : {};
  }

  async authenticateAccessToken(token: string): Promise<AuthenticatedUser> {
    const claims = verifyToken(token, 'access', this.config.jwtAccessSecret);
    if (!claims) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, role: true, phoneVerifiedAt: true },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      role: user.role === 'ADMIN' ? 'admin' : 'member',
      phoneVerified: user.phoneVerifiedAt !== null,
    };
  }

  private async issueTokenPair(userId: string) {
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const refreshId = randomUUID();
    const refreshToken = signToken(
      userId,
      'refresh',
      this.config.jwtRefreshSecret,
      REFRESH_TOKEN_TTL_SECONDS,
      nowSeconds,
      refreshId,
    );
    const accessToken = signToken(
      userId,
      'access',
      this.config.jwtAccessSecret,
      ACCESS_TOKEN_TTL_SECONDS,
      nowSeconds,
    );
    await this.prisma.refreshToken.create({
      data: {
        id: refreshId,
        userId,
        tokenHash: tokenDigest(refreshToken),
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  private hashOtp(userId: string, code: string): string {
    return otpDigest(userId, code, this.config.jwtRefreshSecret);
  }

  private assertLocalOtpAllowed(): void {
    if (this.config.appEnv === 'production') throw new ServiceUnavailableException();
  }

  private toUserProfile(user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    phoneVerifiedAt: Date | null;
    tier: string;
    tierExpiresAt: Date | null;
    verifiedStore: boolean;
    role: string;
    createdAt: Date;
  }): UserProfile {
    return {
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      avatar_url: user.avatarUrl,
      phone_verified: user.phoneVerifiedAt !== null,
      tier: user.tier.toLowerCase(),
      tier_expires_at: user.tierExpiresAt,
      verified_store: user.verifiedStore,
      role: user.role === 'ADMIN' ? 'admin' : 'member',
      created_at: user.createdAt,
    };
  }
}

export function normalizeIndonesianPhone(input: string): string {
  const compact = input.replace(/[\s().-]/g, '');
  const international = compact.startsWith('+62')
    ? compact
    : compact.startsWith('62')
      ? `+${compact}`
      : compact.startsWith('0')
        ? `+62${compact.slice(1)}`
        : '';
  if (!/^\+628[1-9]\d{7,10}$/.test(international)) throw new BadRequestException();
  return international;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );
}
