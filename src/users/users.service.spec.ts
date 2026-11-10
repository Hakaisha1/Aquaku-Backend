import { PrismaService } from '../database/prisma.service';
import { UsersService } from './users.service';

const userId = 'e7b8c921-82e2-4967-8ab4-d732c5815d18';

describe('UsersService', () => {
  it('returns own account details without phone number or password hash', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          email: 'private@example.com',
          displayName: 'Aquaku User',
          avatarUrl: null,
          phoneVerifiedAt: null,
          tier: 'PERSONAL',
          tierExpiresAt: null,
          verifiedStore: false,
          role: 'MEMBER',
          createdAt: new Date('2026-11-09T12:00:00.000Z'),
        }),
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    const result = await service.getMe({ id: userId, role: 'member', phoneVerified: false });
    expect(result).toMatchObject({ email: 'private@example.com', phone_verified: false, role: 'member' });
    expect(result).not.toHaveProperty('phone_number');
    expect(result).not.toHaveProperty('password_hash');
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.not.objectContaining({ phoneNumber: true, passwordHash: true }),
    }));
  });

  it('returns public profile fields without email, phone, or credentials', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          displayName: 'Aquaku User',
          avatarUrl: null,
          tier: 'PERSONAL',
          tierExpiresAt: null,
          verifiedStore: false,
          bio: 'Aquascape enthusiast',
        }),
      },
      rating: {
        aggregate: jest.fn().mockResolvedValue({ _avg: { score: null }, _count: { _all: 0 } }),
      },
      listing: {
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    const result = await service.getPublic(userId);
    expect(result).toEqual({
      id: userId,
      display_name: 'Aquaku User',
      avatar_url: null,
      tier: 'personal',
      verified_store: false,
      rating_average: null,
      rating_count: 0,
      active_listing_count: 0,
      bio: 'Aquascape enthusiast',
    });
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('phone_number');
    expect(result).not.toHaveProperty('password_hash');
  });
});
