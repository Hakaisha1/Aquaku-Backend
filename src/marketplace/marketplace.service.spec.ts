import { Tier, ListingStatus } from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../database/prisma.service';
import { MarketplaceService } from './marketplace.service';
import { CloudinaryClientPort } from './cloudinary-client';

const userId = 'e7b8c921-82e2-4967-8ab4-d732c5815d18';
const account = {
  id: userId,
  tier: Tier.PERSONAL,
  tierExpiresAt: null,
  phoneVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
  whatsappNumber: null,
  personalCooldownUntil: null,
};
const user: AuthenticatedUser = { id: userId, role: 'member', phoneVerified: true };

function setup(overrides: { tier?: Tier; tierExpiresAt?: Date | null; cooldown?: Date | null; count?: number } = {}) {
  const currentAccount = {
    ...account,
    tier: overrides.tier ?? account.tier,
    tierExpiresAt: overrides.tierExpiresAt ?? account.tierExpiresAt,
    personalCooldownUntil: overrides.cooldown ?? account.personalCooldownUntil,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUnique: jest.fn().mockResolvedValue(currentAccount),
      update: jest.fn().mockResolvedValue({}),
    },
    slotAddonGrant: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { slots: null } }),
    },
    cooldownPass: {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    listing: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(overrides.count ?? 0),
      findFirst: jest.fn().mockResolvedValue({ id: 'c7deaa5a-e4cf-450c-a257-f11d9ab8e0bd' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)),
  } as unknown as PrismaService;
  const cloudinary = {} as CloudinaryClientPort;
  return { service: new MarketplaceService(prisma, cloudinary), prisma, tx, currentAccount };
}

describe('MarketplaceService', () => {
  it('falls back to Personal after paid membership expires and reports available capacity', async () => {
    const { service } = setup({
      tier: Tier.TOKO,
      tierExpiresAt: new Date('2025-12-31T23:59:59.000Z'),
      count: 2,
    });
    const result = await service.getQuota(user);
    expect(result).toMatchObject({
      tier: 'personal',
      active_listings: 2,
      base_quota: 5,
      addon_slots: 0,
      available_slots: 3,
      may_list: true,
    });
  });

  it('does not allow listing while a Personal cooldown is active', async () => {
    const { service } = setup({
      cooldown: new Date(Date.now() + 60_000),
      count: 1,
    });
    const result = await service.getQuota(user);
    expect(result.may_list).toBe(false);
    expect(result.cooldown_until).toBeInstanceOf(Date);
  });

  it('starts a seven-day Personal cooldown when a full-quota listing is sold', async () => {
    const { service, tx } = setup({ count: 5 });
    const result = await service.markSold(user, 'c7deaa5a-e4cf-450c-a257-f11d9ab8e0bd');
    expect(result.status).toBe('sold');
    expect(tx.listing.update).toHaveBeenCalledWith({
      where: { id: 'c7deaa5a-e4cf-450c-a257-f11d9ab8e0bd' },
      data: { status: ListingStatus.SOLD, soldAt: expect.any(Date) },
    });
    const update = tx.user.update.mock.calls[0][0] as { data: { personalCooldownUntil: Date } };
    expect(update.data.personalCooldownUntil.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(update.data.personalCooldownUntil.getTime()).toBeLessThan(Date.now() + 8 * 86_400_000);
  });

  it('does not start a sale cooldown when the Personal quota was not full', async () => {
    const { service, tx } = setup({ count: 4 });
    await service.markSold(user, 'c7deaa5a-e4cf-450c-a257-f11d9ab8e0bd');
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
