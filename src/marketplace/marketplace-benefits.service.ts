import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BenefitRequestKind, BenefitRequestStatus, Prisma, Tier } from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../database/prisma.service';
import { CreateAddonRequestDto, CreateMembershipRequestDto, ReviewBenefitRequestDto } from './marketplace-benefits.dto';

const DAY_MILLISECONDS = 86_400_000;
const ENTITLEMENT_DAYS = 30;
const maximumProofBytes = 5 * 1024 * 1024;
const maximumAddonSlots = 1000;
const tierOrder: Record<Tier, number> = { PERSONAL: 0, TOKO: 1, JURAGAN: 2 };
const planCatalog = [
  { tier: Tier.TOKO, price: 40_000, period_days: ENTITLEMENT_DAYS, base_quota: 30, listing_days: 60 },
  { tier: Tier.JURAGAN, price: 100_000, period_days: ENTITLEMENT_DAYS, base_quota: 100, listing_days: 90 },
] as const;

const requestListSelect = {
  id: true,
  kind: true,
  status: true,
  requestedTier: true,
  requestedSlots: true,
  approvedSlots: true,
  paymentAmount: true,
  proofMimeType: true,
  shopId: true,
  reviewNote: true,
  reviewedAt: true,
  entitlementStartsAt: true,
  entitlementExpiresAt: true,
  createdAt: true,
  owner: { select: { id: true, displayName: true, email: true } },
  reviewer: { select: { id: true, displayName: true } },
  shop: { select: { id: true, name: true, verificationStatus: true } },
} satisfies Prisma.BenefitRequestSelect;

type UploadedProof = { buffer: Buffer; size: number };

@Injectable()
export class MarketplaceBenefitsService {
  constructor(private readonly prisma: PrismaService) {}

  getPlans() {
    return planCatalog.map((plan) => ({
      tier: plan.tier.toLowerCase(),
      price: plan.price,
      period_days: plan.period_days,
      base_quota: plan.base_quota,
      listing_days: plan.listing_days,
      features: { may_sell_new_condition: true, cooldown: false },
    }));
  }

  async createMembershipRequest(user: AuthenticatedUser, input: CreateMembershipRequestDto, proof?: UploadedProof) {
    this.assertVerifiedPhone(user);
    const plan = planCatalog.find((candidate) => candidate.tier === input.tier);
    if (!plan) throw new BadRequestException('Unknown membership tier');
    if (input.payment_amount !== plan.price) {
      throw new BadRequestException(`The transfer amount must match the ${plan.price} membership price`);
    }
    const proofData = this.readProof(proof);
    const now = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAccount(tx, user.id);
        const account = await tx.user.findUnique({
          where: { id: user.id },
          select: { tier: true, tierExpiresAt: true },
        });
        if (!account) throw new NotFoundException();
        const activeTier = this.effectiveTier(account.tier, account.tierExpiresAt, now);
        if (tierOrder[plan.tier] < tierOrder[activeTier]) {
          throw new ConflictException('A membership request cannot reduce the current active tier');
        }
        const request = await tx.benefitRequest.create({
          data: {
            ownerId: user.id,
            kind: BenefitRequestKind.MEMBERSHIP,
            requestedTier: plan.tier,
            paymentAmount: input.payment_amount,
            proofBytes: new Uint8Array(proofData.bytes),
            proofMimeType: proofData.mimeType,
          },
          select: requestListSelect,
        });
        return this.presentRequest(request);
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('A pending membership request already exists');
      throw error;
    }
  }

  async createAddonRequest(user: AuthenticatedUser, input: CreateAddonRequestDto, proof?: UploadedProof) {
    this.assertVerifiedPhone(user);
    const kind = input.kind as BenefitRequestKind;
    if (kind === BenefitRequestKind.SLOT_ADDON && (input.slots === undefined || input.slots > maximumAddonSlots)) {
      throw new BadRequestException(`Slot add-on requests must specify 1 to ${maximumAddonSlots} slots`);
    }
    if (kind === BenefitRequestKind.COOLDOWN_BYPASS && input.slots !== undefined) {
      throw new BadRequestException('Cooldown bypass requests cannot include slots');
    }
    const proofData = this.readProof(proof);
    try {
      const request = await this.prisma.benefitRequest.create({
        data: {
          ownerId: user.id,
          kind,
          requestedSlots: kind === BenefitRequestKind.SLOT_ADDON ? input.slots : null,
          paymentAmount: input.payment_amount,
          proofBytes: new Uint8Array(proofData.bytes),
          proofMimeType: proofData.mimeType,
        },
        select: requestListSelect,
      });
      return this.presentRequest(request);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('A pending request of this add-on type already exists');
      throw error;
    }
  }

  async createShopVerificationRequest(user: AuthenticatedUser) {
    this.assertVerifiedPhone(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAccount(tx, user.id);
        const shop = await tx.shop.findUnique({ where: { ownerId: user.id } });
        if (!shop) throw new NotFoundException('Create a shop before requesting verification');
        if (shop.verificationStatus === 'VERIFIED') {
          throw new ConflictException('This shop is already verified');
        }
        if (shop.verificationStatus === 'PENDING') {
          throw new ConflictException('A shop verification request is already pending');
        }
        const request = await tx.benefitRequest.create({
          data: { ownerId: user.id, kind: BenefitRequestKind.SHOP_VERIFICATION, shopId: shop.id },
          select: requestListSelect,
        });
        await tx.shop.update({ where: { id: shop.id }, data: { verificationStatus: 'PENDING' } });
        return this.presentRequest(request);
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('A pending shop verification request already exists');
      throw error;
    }
  }

  async listOwnRequests(user: AuthenticatedUser) {
    const rows = await this.prisma.benefitRequest.findMany({
      where: { ownerId: user.id },
      select: requestListSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.presentRequest(row));
  }

  async listAdminRequests(status?: BenefitRequestStatus) {
    const rows = await this.prisma.benefitRequest.findMany({
      where: status ? { status } : undefined,
      select: requestListSelect,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    return rows.map((row) => this.presentRequest(row));
  }

  async getPrivateProof(requestId: string) {
    const request = await this.prisma.benefitRequest.findUnique({
      where: { id: requestId },
      select: { proofBytes: true, proofMimeType: true },
    });
    if (!request?.proofBytes || !request.proofMimeType) throw new NotFoundException();
    return { bytes: Buffer.from(request.proofBytes), mimeType: request.proofMimeType };
  }

  async reviewRequest(admin: AuthenticatedUser, requestId: string, input: ReviewBenefitRequestDto) {
    const decision = input.decision as BenefitRequestStatus;
    const reviewNote = input.review_note?.trim() || null;
    if (decision === BenefitRequestStatus.REJECTED && !reviewNote) {
      throw new BadRequestException('A rejection reason is required');
    }
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.benefitRequest.findUnique({ where: { id: requestId } });
      if (!initial) throw new NotFoundException();
      await this.lockAccount(tx, initial.ownerId);
      const request = await tx.benefitRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException();
      if (request.status !== BenefitRequestStatus.PENDING) {
        if (request.status === decision) return this.presentRequest(request);
        throw new ConflictException('This request has already been reviewed');
      }

      const now = new Date();
      let approvedSlots: number | null = null;
      let entitlementStartsAt: Date | null = null;
      let entitlementExpiresAt: Date | null = null;

      if (decision === BenefitRequestStatus.APPROVED) {
        if (request.kind === BenefitRequestKind.MEMBERSHIP) {
          if (!request.requestedTier) throw new ConflictException('Membership request is incomplete');
          const account = await tx.user.findUnique({
            where: { id: request.ownerId },
            select: { tier: true, tierExpiresAt: true },
          });
          if (!account) throw new NotFoundException();
          const activeTier = this.effectiveTier(account.tier, account.tierExpiresAt, now);
          if (tierOrder[request.requestedTier] < tierOrder[activeTier]) {
            throw new ConflictException('The requested tier is below the current active tier');
          }
          const startsAt = activeTier === request.requestedTier && account.tierExpiresAt && account.tierExpiresAt > now
            ? account.tierExpiresAt
            : now;
          const expiresAt = new Date(startsAt.getTime() + ENTITLEMENT_DAYS * DAY_MILLISECONDS);
          await tx.user.update({
            where: { id: request.ownerId },
            data: { tier: request.requestedTier, tierExpiresAt: expiresAt },
          });
          entitlementStartsAt = startsAt;
          entitlementExpiresAt = expiresAt;
        } else if (request.kind === BenefitRequestKind.SLOT_ADDON) {
          approvedSlots = input.approved_slots ?? request.requestedSlots;
          if (!approvedSlots || approvedSlots > maximumAddonSlots) {
            throw new BadRequestException(`Approved slot add-ons must be between 1 and ${maximumAddonSlots}`);
          }
          await tx.slotAddonGrant.create({
            data: {
              userId: request.ownerId,
              requestId: request.id,
              slots: approvedSlots,
              expiresAt: new Date(now.getTime() + ENTITLEMENT_DAYS * DAY_MILLISECONDS),
            },
          });
          entitlementStartsAt = now;
          entitlementExpiresAt = new Date(now.getTime() + ENTITLEMENT_DAYS * DAY_MILLISECONDS);
        } else if (request.kind === BenefitRequestKind.COOLDOWN_BYPASS) {
          await tx.cooldownPass.create({
            data: {
              userId: request.ownerId,
              requestId: request.id,
              expiresAt: new Date(now.getTime() + ENTITLEMENT_DAYS * DAY_MILLISECONDS),
            },
          });
          entitlementStartsAt = now;
          entitlementExpiresAt = new Date(now.getTime() + ENTITLEMENT_DAYS * DAY_MILLISECONDS);
        } else if (request.kind === BenefitRequestKind.SHOP_VERIFICATION) {
          if (!request.shopId) throw new ConflictException('Shop verification request is incomplete');
          await tx.shop.update({ where: { id: request.shopId }, data: { verificationStatus: 'VERIFIED' } });
          await tx.user.update({ where: { id: request.ownerId }, data: { verifiedStore: true } });
        }
      } else if (request.kind === BenefitRequestKind.SHOP_VERIFICATION && request.shopId) {
        await tx.shop.update({ where: { id: request.shopId }, data: { verificationStatus: 'REJECTED' } });
      }

      const updated = await tx.benefitRequest.update({
        where: { id: request.id },
        data: {
          status: decision,
          approvedSlots,
          reviewedById: admin.id,
          reviewNote,
          reviewedAt: now,
          entitlementStartsAt,
          entitlementExpiresAt,
        },
      });
      return this.presentRequest(updated);
    }, { timeout: 10_000 });
  }

  async getEntitlements(user: AuthenticatedUser) {
    const now = new Date();
    const [account, grants, passes, shop] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { tier: true, tierExpiresAt: true, personalCooldownUntil: true },
      }),
      this.prisma.slotAddonGrant.findMany({
        where: { userId: user.id, expiresAt: { gt: now }, endedAt: null },
        select: { slots: true, expiresAt: true },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.cooldownPass.count({
        where: { userId: user.id, expiresAt: { gt: now }, consumedAt: null },
      }),
      this.prisma.shop.findUnique({
        where: { ownerId: user.id },
        select: { verificationStatus: true },
      }),
    ]);
    if (!account) throw new NotFoundException();
    const tier = this.effectiveTier(account.tier, account.tierExpiresAt, now);
    const baseQuota = tier === Tier.JURAGAN ? 100 : tier === Tier.TOKO ? 30 : 5;
    return {
      tier: tier.toLowerCase(),
      tier_expires_at: tier === Tier.PERSONAL ? null : account.tierExpiresAt,
      base_quota: baseQuota,
      addon_slots: grants.reduce((total, grant) => total + grant.slots, 0),
      slot_addons: grants.map((grant) => ({ slots: grant.slots, expires_at: grant.expiresAt })),
      available_cooldown_passes: passes,
      cooldown_until: tier === Tier.PERSONAL && account.personalCooldownUntil && account.personalCooldownUntil > now
        ? account.personalCooldownUntil
        : null,
      shop_verification: shop?.verificationStatus.toLowerCase() ?? null,
    };
  }

  private readProof(proof?: UploadedProof): { bytes: Buffer; mimeType: string } {
    if (!proof?.buffer || proof.size < 1 || proof.size > maximumProofBytes || proof.buffer.length !== proof.size) {
      throw new BadRequestException('A transfer proof of at most 5 MB is required');
    }
    const bytes = proof.buffer;
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isPdf = bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
    if (isJpeg) return { bytes, mimeType: 'image/jpeg' };
    if (isPng) return { bytes, mimeType: 'image/png' };
    if (isPdf) return { bytes, mimeType: 'application/pdf' };
    throw new BadRequestException('Transfer proof must be a valid JPEG, PNG, or PDF file');
  }

  private assertVerifiedPhone(user: AuthenticatedUser) {
    if (!user.phoneVerified) throw new ForbiddenException('Phone verification required');
  }

  private effectiveTier(tier: Tier, expiresAt: Date | null, now: Date): Tier {
    if (tier === Tier.PERSONAL) return Tier.PERSONAL;
    return expiresAt && expiresAt > now ? tier : Tier.PERSONAL;
  }

  private async lockAccount(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
    ) AS advisory_lock`;
  }

  private presentRequest(request: {
    id: string;
    kind: BenefitRequestKind;
    status: BenefitRequestStatus;
    requestedTier: Tier | null;
    requestedSlots: number | null;
    approvedSlots: number | null;
    paymentAmount: number | null;
    proofMimeType: string | null;
    shopId: string | null;
    reviewNote: string | null;
    reviewedAt: Date | null;
    entitlementStartsAt: Date | null;
    entitlementExpiresAt: Date | null;
    createdAt: Date;
    owner?: { id: string; displayName: string; email: string };
    reviewer?: { id: string; displayName: string } | null;
    shop?: { id: string; name: string; verificationStatus: string } | null;
  }) {
    return {
      id: request.id,
      kind: request.kind.toLowerCase(),
      status: request.status.toLowerCase(),
      requested_tier: request.requestedTier?.toLowerCase() ?? null,
      requested_slots: request.requestedSlots,
      approved_slots: request.approvedSlots,
      payment_amount: request.paymentAmount,
      proof_available: request.proofMimeType !== null,
      proof_mime_type: request.proofMimeType,
      shop: request.shop ? {
        id: request.shop.id,
        name: request.shop.name,
        verification_status: request.shop.verificationStatus.toLowerCase(),
      } : null,
      reviewed_by: request.reviewer ?? null,
      review_note: request.reviewNote,
      reviewed_at: request.reviewedAt,
      entitlement_starts_at: request.entitlementStartsAt,
      entitlement_expires_at: request.entitlementExpiresAt,
      created_at: request.createdAt,
      ...(request.owner ? { owner: request.owner } : {}),
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
