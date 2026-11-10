import { BenefitRequestKind, BenefitRequestStatus, Tier } from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../database/prisma.service';
import { MarketplaceBenefitsService } from './marketplace-benefits.service';

const user: AuthenticatedUser = {
  id: 'e7b8c921-82e2-4967-8ab4-d732c5815d18',
  role: 'member',
  phoneVerified: true,
};

function setup() {
  const row = {
    id: 'c7deaa5a-e4cf-450c-a257-f11d9ab8e0bd',
    kind: BenefitRequestKind.MEMBERSHIP,
    status: BenefitRequestStatus.PENDING,
    requestedTier: Tier.TOKO,
    requestedSlots: null,
    approvedSlots: null,
    paymentAmount: 40_000,
    proofMimeType: 'application/pdf',
    shopId: null,
    reviewNote: null,
    reviewedAt: null,
    entitlementStartsAt: null,
    entitlementExpiresAt: null,
    createdAt: new Date(),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUnique: jest.fn().mockResolvedValue({ tier: Tier.PERSONAL, tierExpiresAt: null }) },
    benefitRequest: { create: jest.fn().mockResolvedValue(row) },
  };
  const prisma = {
    $transaction: jest.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)),
  } as unknown as PrismaService;
  return { service: new MarketplaceBenefitsService(prisma), prisma, tx, row };
}

describe('MarketplaceBenefitsService', () => {
  it('publishes the established membership prices and entitlements', () => {
    const { service } = setup();
    expect(service.getPlans()).toEqual([
      expect.objectContaining({ tier: 'toko', price: 40_000, period_days: 30, base_quota: 30 }),
      expect.objectContaining({ tier: 'juragan', price: 100_000, period_days: 30, base_quota: 100 }),
    ]);
  });

  it('stores a validated private proof with a membership request', async () => {
    const { service, tx } = setup();
    const bytes = Buffer.from('%PDF-1.7 fake test content');
    const result = await service.createMembershipRequest(
      user,
      { tier: 'TOKO', payment_amount: 40_000 },
      { buffer: bytes, size: bytes.length },
    );
    expect(result).toMatchObject({ kind: 'membership', status: 'pending', proof_available: true });
    expect(tx.benefitRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: BenefitRequestKind.MEMBERSHIP,
        requestedTier: Tier.TOKO,
        paymentAmount: 40_000,
        proofMimeType: 'application/pdf',
        proofBytes: expect.any(Uint8Array),
      }),
    }));
  });

  it('rejects unverified file contents and a transfer amount that does not match the plan', async () => {
    const { service, tx } = setup();
    const fakeImage = Buffer.from('not actually a png');
    await expect(service.createMembershipRequest(
      user,
      { tier: 'TOKO', payment_amount: 40_000 },
      { buffer: fakeImage, size: fakeImage.length },
    )).rejects.toThrow('valid JPEG, PNG, or PDF');
    await expect(service.createMembershipRequest(
      user,
      { tier: 'TOKO', payment_amount: 1 },
      { buffer: Buffer.from('%PDF-1.7'), size: 8 },
    )).rejects.toThrow('must match');
    expect(tx.benefitRequest.create).not.toHaveBeenCalled();
  });
});
