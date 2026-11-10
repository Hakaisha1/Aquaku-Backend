import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuthenticatedUser, UserProfile, normalizeIndonesianPhone } from '../auth/auth.service';
import { UpdateProfileDto } from './users.dto';

const selfSelection = {
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

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(authenticatedUser: AuthenticatedUser): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: authenticatedUser.id },
      select: selfSelection,
    });
    if (!user) throw new NotFoundException();
    return this.toUserProfile(user);
  }

  async updateMe(authenticatedUser: AuthenticatedUser, input: UpdateProfileDto): Promise<UserProfile> {
    if (input.display_name !== undefined && !input.display_name.trim()) {
      throw new BadRequestException();
    }
    const user = await this.prisma.user.update({
      where: { id: authenticatedUser.id },
      data: {
        ...(input.display_name === undefined ? {} : { displayName: input.display_name.trim() }),
        ...(input.avatar_url === undefined ? {} : { avatarUrl: input.avatar_url }),
        ...(input.whatsapp_number === undefined
          ? {}
          : { whatsappNumber: normalizeIndonesianPhone(input.whatsapp_number) }),
        ...(input.bio === undefined ? {} : { bio: input.bio }),
      },
      select: selfSelection,
    });
    return this.toUserProfile(user);
  }

  async getPublic(userId: string) {
    const [user, ratings, activeListingCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          tier: true,
          tierExpiresAt: true,
          verifiedStore: true,
          bio: true,
        },
      }),
      this.prisma.rating.aggregate({
        where: { sellerId: userId },
        _avg: { score: true },
        _count: { _all: true },
      }),
      this.prisma.listing.count({
        where: {
          sellerId: userId,
          status: 'ACTIVE',
          deletedAt: null,
          moderationHiddenAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
    if (!user) throw new NotFoundException();
    const effectiveTier = user.tier !== 'PERSONAL' && user.tierExpiresAt && user.tierExpiresAt <= new Date()
      ? 'personal'
      : user.tier.toLowerCase();
    return {
      id: user.id,
      display_name: user.displayName,
      avatar_url: user.avatarUrl,
      tier: effectiveTier,
      verified_store: user.verifiedStore,
      rating_average: ratings._avg.score,
      rating_count: ratings._count._all,
      active_listing_count: activeListingCount,
      bio: user.bio,
    };
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
