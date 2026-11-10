import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, Tier, ListingCondition, ListingStatus, SaleTransactionStatus } from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../database/prisma.service';
import { CLOUDINARY_CLIENT, CloudinaryClientPort } from './cloudinary-client';
import {
  CreateListingDto,
  CreateShopDto,
  ListingSearchDto,
  UpdateListingDto,
} from './marketplace.dto';

const tierOrder: Record<Tier, number> = { PERSONAL: 0, TOKO: 1, JURAGAN: 2 };
const tierPolicy: Record<Tier, { quota: number; listingDays: number }> = {
  PERSONAL: { quota: 5, listingDays: 30 },
  TOKO: { quota: 30, listingDays: 60 },
  JURAGAN: { quota: 100, listingDays: 90 },
};
const maximumPhotoBytes = 5 * 1024 * 1024;
const maximumPhotos = 8;
const allowedPhotoFormats = new Set(['jpg', 'jpeg', 'png', 'webp']);
const minimumPhotos = (condition: ListingCondition) =>
  condition === ListingCondition.LIKE_NEW || condition === ListingCondition.SECOND ? 3 : 1;

const listingInclude = {
  category: { select: { id: true, slug: true, name: true } },
  region: { select: { code: true, districtCode: true, districtName: true, villageName: true } },
  photos: {
    where: { uploadedAt: { not: null } },
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, secureUrl: true },
  },
  seller: {
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      tier: true,
      tierExpiresAt: true,
      whatsappNumber: true,
      verifiedStore: true,
      shop: { select: { id: true, name: true } },
    },
  },
  shop: { select: { id: true, name: true } },
} satisfies Prisma.ListingInclude;

type ListingWithDetails = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;
type MarketplaceTransaction = Prisma.TransactionClient;
type AccountState = {
  id: string;
  tier: Tier;
  tierExpiresAt: Date | null;
  phoneVerifiedAt: Date | null;
  whatsappNumber: string | null;
  personalCooldownUntil: Date | null;
};

@Injectable()
export class MarketplaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceService.name);
  private expirationTimer?: NodeJS.Timeout;
  private expirationRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOUDINARY_CLIENT) private readonly cloudinary: CloudinaryClientPort,
  ) {}

  onModuleInit(): void {
    this.expirationTimer = setInterval(() => {
      void this.expireDueListings().catch(() => this.logger.warn('Listing expiration batch failed'));
    }, 60_000);
    this.expirationTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.expirationTimer) clearInterval(this.expirationTimer);
  }

  async getRegions() {
    const rows = await this.prisma.region.findMany({
      orderBy: [{ districtName: 'asc' }, { villageName: 'asc' }],
      select: { code: true, districtCode: true, districtName: true, villageName: true },
    });
    return rows.map((row) => ({
      code: row.code,
      district_code: row.districtCode,
      district: row.districtName,
      kelurahan: row.villageName,
    }));
  }

  async getTaxonomy() {
    const [categories, tags] = await Promise.all([
      this.prisma.category.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      this.prisma.listingTag.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return {
      categories: categories.map(({ id, slug, name }) => ({ id, slug, name })),
      tags: tags.map(({ id, slug, name, minimumTier }) => ({
        id,
        slug,
        name,
        minimum_tier: minimumTier.toLowerCase(),
      })),
    };
  }

  async listListings(query: ListingSearchDto) {
    if (query.min_price !== undefined && query.max_price !== undefined && query.min_price > query.max_price) {
      throw new BadRequestException('min_price must not exceed max_price');
    }
    const now = new Date();
    const where: Prisma.ListingWhereInput = {
      status: ListingStatus.ACTIVE,
      deletedAt: null,
      moderationHiddenAt: null,
      expiresAt: { gt: now },
      ...(query.q ? {
        OR: [
          { title: { contains: query.q.trim(), mode: 'insensitive' } },
          { description: { contains: query.q.trim(), mode: 'insensitive' } },
        ],
      } : {}),
      ...(query.category ? { category: { slug: query.category, active: true } } : {}),
      ...(query.condition ? { condition: query.condition } : {}),
      ...(query.region_code ? { regionCode: query.region_code } : {}),
      ...(query.district_code ? { region: { districtCode: query.district_code } } : {}),
      ...(query.min_price !== undefined || query.max_price !== undefined ? {
        price: {
          ...(query.min_price === undefined ? {} : { gte: query.min_price }),
          ...(query.max_price === undefined ? {} : { lte: query.max_price }),
        },
      } : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const orderBy: Prisma.ListingOrderByWithRelationInput[] = query.sort === 'price_asc'
      ? [{ price: 'asc' }, { createdAt: 'desc' }]
      : query.sort === 'price_desc'
        ? [{ price: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items: rows.map((row) => this.presentListing(row)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getListing(listingId: string) {
    const listing = await this.prisma.listing.findFirst({
      where: {
        id: listingId,
        status: ListingStatus.ACTIVE,
        deletedAt: null,
        moderationHiddenAt: null,
        expiresAt: { gt: new Date() },
      },
      include: listingInclude,
    });
    if (!listing) throw new NotFoundException();
    return this.presentListing(listing);
  }

  async listMyListings(user: AuthenticatedUser, page = 1, limit = 20) {
    const where: Prisma.ListingWhereInput = { sellerId: user.id, deletedAt: null };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.listing.count({ where }),
      this.prisma.listing.findMany({
        where,
        include: listingInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items: rows.map((row) => this.presentListing(row)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async createShop(user: AuthenticatedUser, input: CreateShopDto) {
    const account = await this.getAccount(user.id);
    if (!account.phoneVerifiedAt) throw new ForbiddenException('Phone verification required');
    const tier = this.effectiveTier(account, new Date());
    if (tier === Tier.PERSONAL) throw new ForbiddenException('A paid seller tier is required');
    const existing = await this.prisma.shop.findUnique({ where: { ownerId: user.id } });
    if (existing) throw new ConflictException('An account can have only one shop');
    try {
      const shop = await this.prisma.shop.create({
        data: { ownerId: user.id, name: input.name.trim(), description: input.description?.trim() || null },
      });
      return this.presentShop(shop);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('An account can have only one shop');
      throw error;
    }
  }

  async getMyShop(user: AuthenticatedUser) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId: user.id } });
    if (!shop) throw new NotFoundException();
    return this.presentShop(shop);
  }

  async createUploadSignature(user: AuthenticatedUser) {
    const account = await this.getAccount(user.id);
    if (!account.phoneVerifiedAt) throw new ForbiddenException('Phone verification required');
    const signature = this.cloudinary.createUploadSignature(user.id);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId: user.id,
        publicId: signature.publicId,
        signedAt: new Date(signature.timestamp * 1000),
      },
      select: { id: true },
    });
    return {
      asset_id: asset.id,
      cloud_name: signature.cloudName,
      api_key: signature.apiKey,
      timestamp: signature.timestamp,
      public_id: signature.publicId,
      folder: signature.folder,
      allowed_formats: signature.allowedFormats,
      upload_preset: signature.uploadPreset,
      overwrite: signature.overwrite,
      signature: signature.signature,
    };
  }

  async confirmUpload(user: AuthenticatedUser, assetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: assetId, ownerId: user.id } });
    if (!asset) throw new NotFoundException();
    if (asset.uploadedAt) return this.presentMediaAsset(asset);
    if (Date.now() - asset.signedAt.getTime() > 15 * 60_000) {
      throw new BadRequestException('Upload signature has expired');
    }
    if (!asset.publicId.startsWith(`aquaku_${user.id.replaceAll('-', '')}_`)) {
      throw new ForbiddenException();
    }
    const uploaded = await this.cloudinary.verifyUpload(asset.publicId);
    if (
      uploaded.publicId !== asset.publicId ||
      uploaded.bytes < 1 || uploaded.bytes > maximumPhotoBytes ||
      !allowedPhotoFormats.has(uploaded.format.toLowerCase())
    ) {
      try {
        await this.cloudinary.deleteAsset(asset.publicId);
      } catch {
        this.logger.warn('Rejected Cloudinary upload could not be cleaned up');
      }
      throw new BadRequestException('Photo must be JPEG, PNG, or WebP up to 5 MB');
    }
    const saved = await this.prisma.mediaAsset.updateMany({
      where: { id: asset.id, ownerId: user.id, uploadedAt: null },
      data: {
        secureUrl: uploaded.secureUrl,
        format: uploaded.format.toLowerCase(),
        bytes: uploaded.bytes,
        uploadedAt: new Date(),
      },
    });
    if (saved.count !== 1) throw new ConflictException('Upload has already been confirmed');
    const confirmed = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    return this.presentMediaAsset(confirmed);
  }

  async deleteMediaAsset(user: AuthenticatedUser, assetId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      const asset = await tx.mediaAsset.findFirst({
        where: { id: assetId, ownerId: user.id },
        include: { listing: { select: { id: true, sellerId: true, condition: true, status: true, deletedAt: true } } },
      });
      if (!asset) throw new NotFoundException();
      if (asset.listing) {
        if (asset.listing.sellerId !== user.id) throw new ForbiddenException();
        if (asset.listing.status === ListingStatus.ACTIVE && asset.listing.deletedAt === null) {
          const count = await tx.mediaAsset.count({
            where: { listingId: asset.listing.id, uploadedAt: { not: null } },
          });
          if (count - 1 < minimumPhotos(asset.listing.condition)) {
            throw new ConflictException('The listing would not meet its minimum photo requirement');
          }
        }
      }
      await this.cloudinary.deleteAsset(asset.publicId);
      await tx.mediaAsset.delete({ where: { id: asset.id } });
      return { deleted: true };
    }, { timeout: 10_000 });
  }

  async createListing(user: AuthenticatedUser, input: CreateListingDto) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      let account = await this.getAccount(user.id, tx);
      if (!account.phoneVerifiedAt) throw new ForbiddenException('Phone verification required');
      await this.processDueListings(tx, account, now);
      account = await this.getAccount(user.id, tx);
      const tier = this.effectiveTier(account, now);
      await this.assertNoCooldownOrConsumePass(tx, account, tier, now, input.cooldown_pass_id);
      await this.assertCapacity(tx, account.id, tier, now);
      const [category, region] = await Promise.all([
        tx.category.findFirst({ where: { id: input.category_id, active: true } }),
        tx.region.findUnique({ where: { code: input.region_code } }),
      ]);
      if (!category) throw new BadRequestException('Unknown category');
      if (!region) throw new BadRequestException('Location must be a valid Kota Semarang kelurahan');
      const shopId = await this.validateShop(tx, user.id, tier, input.shop_id);
      const tag = await this.assertConditionAllowed(tx, tier, input.condition);
      await this.assertPhotos(tx, user.id, input.photo_ids, input.condition);
      const listing = await tx.listing.create({
        data: {
          sellerId: user.id,
          shopId,
          categoryId: category.id,
          regionCode: region.code,
          title: input.title.trim(),
          description: input.description.trim(),
          price: input.price,
          condition: input.condition,
          expiresAt: new Date(now.getTime() + tierPolicy[tier].listingDays * 86_400_000),
          tags: { create: [{ tagId: tag.id }] },
        },
        include: listingInclude,
      });
      const attached = await tx.mediaAsset.updateMany({
        where: {
          id: { in: input.photo_ids },
          ownerId: user.id,
          listingId: null,
          uploadedAt: { not: null },
        },
        data: { listingId: listing.id },
      });
      if (attached.count !== input.photo_ids.length) throw new BadRequestException('One or more photos are unavailable');
      const result = await tx.listing.findUniqueOrThrow({ where: { id: listing.id }, include: listingInclude });
      return this.presentListing(result);
    });
  }

  async updateListing(user: AuthenticatedUser, listingId: string, input: UpdateListingDto) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      let account = await this.getAccount(user.id, tx);
      await this.processDueListings(tx, account, now);
      account = await this.getAccount(user.id, tx);
      const listing = await tx.listing.findFirst({
        where: {
          id: listingId,
          sellerId: user.id,
          status: ListingStatus.ACTIVE,
          deletedAt: null,
          moderationHiddenAt: null,
        },
        include: { photos: { where: { uploadedAt: { not: null } } } },
      });
      if (!listing || listing.expiresAt <= now) throw new NotFoundException();
      if (!account.phoneVerifiedAt) throw new ForbiddenException('Phone verification required');
      const tier = this.effectiveTier(account, now);
      const condition = input.condition ?? listing.condition;
      const categoryId = input.category_id ?? listing.categoryId;
      const regionCode = input.region_code ?? listing.regionCode;
      const tag = await this.assertConditionAllowed(tx, tier, condition);
      const category = await tx.category.findFirst({ where: { id: categoryId, active: true } });
      if (!category) throw new BadRequestException('Unknown category');
      const region = await tx.region.findUnique({ where: { code: regionCode } });
      if (!region) throw new BadRequestException('Location must be a valid Kota Semarang kelurahan');
      const photoIds = input.photo_ids ?? listing.photos.map((photo) => photo.id);
      if (listing.photos.some((photo) => !photoIds.includes(photo.id))) {
        throw new ConflictException('Remove existing photos through DELETE /marketplace/media/:assetId');
      }
      await this.assertPhotos(tx, user.id, photoIds, condition, listingId);
      await tx.listing.update({
        where: { id: listing.id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          ...(input.description === undefined ? {} : { description: input.description.trim() }),
          ...(input.price === undefined ? {} : { price: input.price }),
          condition,
          categoryId: category.id,
          regionCode: region.code,
          tags: {
            deleteMany: {},
            create: [{ tagId: tag.id }],
          },
        },
      });
      if (input.photo_ids !== undefined) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: photoIds }, ownerId: user.id, listingId: null, uploadedAt: { not: null } },
          data: { listingId },
        });
        const attachedPhotos = await tx.mediaAsset.findMany({
          where: { id: { in: photoIds }, ownerId: user.id, listingId, uploadedAt: { not: null } },
          select: { id: true },
        });
        if (attachedPhotos.length !== photoIds.length) {
          throw new BadRequestException('One or more photos are unavailable');
        }
      }
      const updated = await tx.listing.findUniqueOrThrow({ where: { id: listingId }, include: listingInclude });
      return this.presentListing(updated);
    });
  }

  async markSold(user: AuthenticatedUser, listingId: string, buyerId?: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      let account = await this.getAccount(user.id, tx);
      await this.processDueListings(tx, account, now);
      account = await this.getAccount(user.id, tx);
      const listing = await tx.listing.findFirst({
        where: {
          id: listingId,
          sellerId: user.id,
          status: ListingStatus.ACTIVE,
          deletedAt: null,
          moderationHiddenAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (!listing) throw new NotFoundException();
      if (buyerId === user.id) throw new BadRequestException('Seller cannot be the transaction buyer');
      if (buyerId) await this.assertVerifiedBuyer(tx, buyerId);
      const tier = this.effectiveTier(account, now);
      const [activeCount, addonSlots] = await Promise.all([
        tx.listing.count({ where: { sellerId: user.id, status: ListingStatus.ACTIVE, deletedAt: null } }),
        this.getActiveAddonSlots(tx, user.id, now),
      ]);
      await tx.listing.update({ where: { id: listingId }, data: { status: ListingStatus.SOLD, soldAt: now } });
      if (
        tier === Tier.PERSONAL && activeCount >= tierPolicy[tier].quota + addonSlots &&
        !this.cooldownActive(account, now)
      ) {
        await tx.user.update({
          where: { id: user.id },
          data: { personalCooldownUntil: new Date(now.getTime() + 7 * 86_400_000) },
        });
      }
      const sale = buyerId
        ? await tx.saleTransaction.create({
          data: { listingId, sellerId: user.id, buyerId, status: SaleTransactionStatus.AWAITING_CONFIRMATION },
          select: { id: true, buyerId: true, status: true },
        })
        : null;
      return {
        id: listingId,
        status: 'sold',
        sold_at: now,
        transaction: sale ? { id: sale.id, buyer_id: sale.buyerId, status: sale.status.toLowerCase() } : null,
      };
    });
  }

  async deleteListing(user: AuthenticatedUser, listingId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      let account = await this.getAccount(user.id, tx);
      await this.processDueListings(tx, account, now);
      account = await this.getAccount(user.id, tx);
      const listing = await tx.listing.findFirst({
        where: {
          id: listingId,
          sellerId: user.id,
          status: { in: [ListingStatus.ACTIVE, ListingStatus.INACTIVE] },
          deletedAt: null,
        },
        select: { id: true, status: true },
      });
      if (!listing) throw new NotFoundException();
      const tier = this.effectiveTier(account, now);
      await tx.listing.update({ where: { id: listingId }, data: { deletedAt: now } });
      if (listing.status === ListingStatus.INACTIVE) return { id: listingId, deleted: true };
      if (tier === Tier.PERSONAL) {
        const current = this.cooldownActive(account, now) ? account.personalCooldownUntil! : now;
        const cooldownUntil = new Date(Math.max(current.getTime(), now.getTime() + 2 * 86_400_000));
        await tx.user.update({ where: { id: user.id }, data: { personalCooldownUntil: cooldownUntil } });
      }
      return { id: listingId, deleted: true };
    });
  }

  async reactivateListing(user: AuthenticatedUser, listingId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      let account = await this.getAccount(user.id, tx);
      await this.processDueListings(tx, account, now);
      account = await this.getAccount(user.id, tx);
      const tier = this.effectiveTier(account, now);
      this.assertNoCooldown(account, tier, now);
      const listing = await tx.listing.findFirst({
        where: { id: listingId, sellerId: user.id, status: ListingStatus.INACTIVE, deletedAt: null },
        include: { photos: { where: { uploadedAt: { not: null } } } },
      });
      if (!listing || !listing.suspendedAt || !listing.suspensionReason) throw new NotFoundException();
      const remainingMilliseconds = listing.expiresAt.getTime() - listing.suspendedAt.getTime();
      if (remainingMilliseconds <= 0) {
        await tx.listing.update({
          where: { id: listing.id },
          data: { status: ListingStatus.EXPIRED, suspendedAt: null, suspensionReason: null },
        });
        return { id: listing.id, status: 'expired' };
      }
      await this.assertCapacity(tx, account.id, tier, now);
      await this.assertConditionAllowed(tx, tier, listing.condition);
      if (listing.photos.length < minimumPhotos(listing.condition)) {
        throw new ConflictException('The listing no longer meets its minimum photo requirement');
      }
      const updated = await tx.listing.update({
        where: { id: listing.id },
        data: {
          status: ListingStatus.ACTIVE,
          expiresAt: new Date(now.getTime() + remainingMilliseconds),
          suspendedAt: null,
          suspensionReason: null,
        },
        include: listingInclude,
      });
      return this.presentListing(updated);
    });
  }

  async renewListing(user: AuthenticatedUser, listingId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      let account = await this.getAccount(user.id, tx);
      await this.processDueListings(tx, account, now);
      account = await this.getAccount(user.id, tx);
      const tier = this.effectiveTier(account, now);
      this.assertNoCooldown(account, tier, now);
      await this.assertCapacity(tx, account.id, tier, now);
      const listing = await tx.listing.findFirst({
        where: {
          id: listingId,
          sellerId: user.id,
          status: ListingStatus.EXPIRED,
          deletedAt: null,
          moderationHiddenAt: null,
        },
        include: { photos: { where: { uploadedAt: { not: null } } } },
      });
      if (!listing) throw new NotFoundException();
      await this.assertConditionAllowed(tx, tier, listing.condition);
      if (listing.photos.length < minimumPhotos(listing.condition)) {
        throw new ConflictException('The listing no longer meets its minimum photo requirement');
      }
      const updated = await tx.listing.update({
        where: { id: listing.id },
        data: {
          status: ListingStatus.ACTIVE,
          expiresAt: new Date(now.getTime() + tierPolicy[tier].listingDays * 86_400_000),
        },
        include: listingInclude,
      });
      return this.presentListing(updated);
    });
  }

  async getQuota(user: AuthenticatedUser) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, user.id);
      let account = await this.getAccount(user.id, tx);
      await this.processDueListings(tx, account, now);
      account = await this.getAccount(user.id, tx);
      const tier = this.effectiveTier(account, now);
      const active = await tx.listing.count({
        where: { sellerId: user.id, status: ListingStatus.ACTIVE, deletedAt: null, expiresAt: { gt: now } },
      });
      const addonSlots = await this.getActiveAddonSlots(tx, user.id, now);
      const quota = tierPolicy[tier].quota + addonSlots;
      const cooldownActive = tier === Tier.PERSONAL && this.cooldownActive(account, now);
      const availablePasses = await tx.cooldownPass.count({
        where: { userId: user.id, expiresAt: { gt: now }, consumedAt: null },
      });
      return {
        tier: tier.toLowerCase(),
        active_listings: active,
        inactive_listings: await tx.listing.count({
          where: { sellerId: user.id, status: ListingStatus.INACTIVE, deletedAt: null },
        }),
        base_quota: tierPolicy[tier].quota,
        addon_slots: addonSlots,
        total_quota: quota,
        available_slots: Math.max(0, quota - active),
        available_cooldown_passes: availablePasses,
        cooldown_until: cooldownActive ? account.personalCooldownUntil : null,
        may_list: active < quota && !cooldownActive,
        may_list_with_cooldown_pass: active < quota && (availablePasses > 0 || !cooldownActive),
      };
    });
  }

  async expireDueListings(): Promise<number> {
    if (this.expirationRunning) return 0;
    this.expirationRunning = true;
    let expiredCount = 0;
    try {
      const now = new Date();
      const [due, accountsWithExpiringRights] = await Promise.all([
        this.prisma.listing.findMany({
          where: { status: ListingStatus.ACTIVE, deletedAt: null, expiresAt: { lte: now } },
          select: { id: true, sellerId: true },
          orderBy: { expiresAt: 'asc' },
          take: 100,
        }),
        this.prisma.user.findMany({
          where: {
            OR: [
              { tier: { not: Tier.PERSONAL }, tierExpiresAt: { lte: now } },
              { slotAddonGrants: { some: { expiresAt: { lte: now }, endedAt: null } } },
            ],
          },
          select: { id: true },
          take: 100,
        }),
      ]);
      const ownerIds = new Set([
        ...due.map((candidate) => candidate.sellerId),
        ...accountsWithExpiringRights.map((account) => account.id),
      ]);
      for (const ownerId of ownerIds) {
        const listingIds = due.filter((candidate) => candidate.sellerId === ownerId).map((candidate) => candidate.id);
        const changed = await this.prisma.$transaction(async (tx) => {
          await this.lockAccount(tx, ownerId);
          const account = await this.getAccount(ownerId, tx);
          let affected = 0;
          if (listingIds.length) {
            for (const listingId of listingIds) {
              affected += await this.processDueListings(tx, account, now, listingId);
            }
          } else {
            affected += await this.processDueListings(tx, account, now);
          }
          return affected;
        });
        expiredCount += changed;
      }
      return expiredCount;
    } finally {
      this.expirationRunning = false;
    }
  }

  private async processDueListings(
    tx: MarketplaceTransaction,
    account: AccountState,
    now: Date,
    listingId?: string,
  ): Promise<number> {
    const due = await tx.listing.findMany({
      where: {
        sellerId: account.id,
        status: ListingStatus.ACTIVE,
        deletedAt: null,
        expiresAt: { lte: now },
        ...(listingId ? { id: listingId } : {}),
      },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
    const tier = this.effectiveTier(account, now);
    let expiredCount = 0;
    if (due.length > 0) {
      let activeCount = await tx.listing.count({
        where: { sellerId: account.id, status: ListingStatus.ACTIVE, deletedAt: null },
      });
      const quota = tierPolicy[tier].quota + await this.getActiveAddonSlots(tx, account.id, now);
      let cooldownUntil = account.personalCooldownUntil;
      for (const candidate of due) {
        const changed = await tx.listing.updateMany({
          where: { id: candidate.id, status: ListingStatus.ACTIVE, deletedAt: null },
          data: { status: ListingStatus.EXPIRED },
        });
        if (changed.count === 0) continue;
        expiredCount += changed.count;
        if (
          tier === Tier.PERSONAL && activeCount >= quota &&
          (cooldownUntil === null || cooldownUntil <= now)
        ) {
          cooldownUntil = new Date(now.getTime() + 7 * 86_400_000);
        }
        activeCount -= 1;
      }
      if (cooldownUntil !== account.personalCooldownUntil) {
        await tx.user.update({ where: { id: account.id }, data: { personalCooldownUntil: cooldownUntil } });
      }
    }
    await this.reconcileAccountListings(tx, account.id, now);
    return expiredCount;
  }

  private async assertCapacity(tx: MarketplaceTransaction, sellerId: string, tier: Tier, now: Date) {
    const [count, addonSlots] = await Promise.all([
      tx.listing.count({
        where: { sellerId, status: ListingStatus.ACTIVE, deletedAt: null, expiresAt: { gt: now } },
      }),
      this.getActiveAddonSlots(tx, sellerId, now),
    ]);
    if (count >= tierPolicy[tier].quota + addonSlots) {
      throw new ConflictException('Active listing quota is full');
    }
  }

  private async getActiveAddonSlots(tx: MarketplaceTransaction, userId: string, now: Date): Promise<number> {
    const result = await tx.slotAddonGrant.aggregate({
      where: { userId, expiresAt: { gt: now }, endedAt: null },
      _sum: { slots: true },
    });
    return result._sum.slots ?? 0;
  }

  private async assertNoCooldownOrConsumePass(
    tx: MarketplaceTransaction,
    account: AccountState,
    tier: Tier,
    now: Date,
    passId?: string,
  ) {
    const cooldownActive = tier === Tier.PERSONAL && this.cooldownActive(account, now);
    if (!cooldownActive) {
      if (passId) throw new BadRequestException('A cooldown pass can only be used during an active cooldown');
      return;
    }
    if (!passId) {
      this.assertNoCooldown(account, tier, now);
      return;
    }
    const consumed = await tx.cooldownPass.updateMany({
      where: {
        id: passId,
        userId: account.id,
        consumedAt: null,
        expiresAt: { gt: now },
        request: { status: 'APPROVED' },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new ConflictException('Cooldown pass is unavailable or already used');
  }

  private async reconcileAccountListings(tx: MarketplaceTransaction, userId: string, now: Date) {
    await tx.slotAddonGrant.updateMany({
      where: { userId, expiresAt: { lte: now }, endedAt: null },
      data: { endedAt: now },
    });
    const account = await this.getAccount(userId, tx);
    let tier = this.effectiveTier(account, now);
    if (account.tier !== Tier.PERSONAL && tier === Tier.PERSONAL) {
      await tx.user.update({ where: { id: userId }, data: { tier: Tier.PERSONAL, tierExpiresAt: null } });
      tier = Tier.PERSONAL;
    }
    const addonSlots = await this.getActiveAddonSlots(tx, userId, now);
    const quota = tierPolicy[tier].quota + addonSlots;
    const activeListings = await tx.listing.findMany({
      where: { sellerId: userId, status: ListingStatus.ACTIVE, deletedAt: null, expiresAt: { gt: now } },
      select: { id: true, condition: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const conditionRestricted = tier === Tier.PERSONAL
      ? activeListings.filter((listing) => listing.condition === ListingCondition.BNIB || listing.condition === ListingCondition.NEW)
      : [];
    for (const listing of conditionRestricted) {
      await tx.listing.update({
        where: { id: listing.id },
        data: {
          status: ListingStatus.INACTIVE,
          suspendedAt: now,
          suspensionReason: 'TIER_CONDITION',
        },
      });
    }
    const eligible = activeListings.filter((listing) => !conditionRestricted.some((item) => item.id === listing.id));
    const overQuota = Math.max(0, eligible.length - quota);
    const quotaRestricted = overQuota > 0 ? eligible.slice(-overQuota).reverse() : [];
    for (const listing of quotaRestricted) {
      await tx.listing.update({
        where: { id: listing.id },
        data: {
          status: ListingStatus.INACTIVE,
          suspendedAt: now,
          suspensionReason: 'QUOTA',
        },
      });
    }
  }

  private async assertConditionAllowed(tx: MarketplaceTransaction, tier: Tier, condition: ListingCondition) {
    const slug = condition === ListingCondition.LIKE_NEW ? 'like-new' : condition.toLowerCase();
    const tag = await tx.listingTag.findUnique({ where: { slug } });
    if (!tag || tierOrder[tier] < tierOrder[tag.minimumTier]) {
      throw new ForbiddenException('The current seller tier cannot use this listing condition');
    }
    return tag;
  }

  private async assertPhotos(
    tx: MarketplaceTransaction,
    ownerId: string,
    photoIds: readonly string[],
    condition: ListingCondition,
    listingId?: string,
  ) {
    if (new Set(photoIds).size !== photoIds.length) throw new BadRequestException('Photo IDs must be unique');
    if (photoIds.length < minimumPhotos(condition) || photoIds.length > maximumPhotos) {
      throw new BadRequestException(`This condition requires ${minimumPhotos(condition)} to ${maximumPhotos} photos`);
    }
    const photos = await tx.mediaAsset.findMany({
      where: {
        id: { in: [...photoIds] },
        ownerId,
        uploadedAt: { not: null },
        bytes: { lte: maximumPhotoBytes },
        format: { in: ['jpg', 'jpeg', 'png', 'webp'] },
        OR: [{ listingId: null }, ...(listingId ? [{ listingId }] : [])],
      },
      select: { id: true },
    });
    if (photos.length !== photoIds.length) throw new BadRequestException('One or more photos are unavailable');
  }

  private async assertVerifiedBuyer(tx: MarketplaceTransaction, buyerId: string) {
    const buyer = await tx.user.findUnique({ where: { id: buyerId }, select: { phoneVerifiedAt: true } });
    if (!buyer) throw new NotFoundException('Buyer account not found');
    if (!buyer.phoneVerifiedAt) throw new ForbiddenException('Buyer phone verification required');
  }

  private async validateShop(tx: MarketplaceTransaction, ownerId: string, tier: Tier, shopId?: string) {
    if (!shopId) return null;
    if (tier === Tier.PERSONAL) throw new ForbiddenException('A paid seller tier is required to use a shop');
    const shop = await tx.shop.findFirst({ where: { id: shopId, ownerId } });
    if (!shop) throw new BadRequestException('Shop does not belong to this account');
    return shop.id;
  }

  private assertNoCooldown(account: AccountState, tier: Tier, now: Date) {
    if (tier === Tier.PERSONAL && this.cooldownActive(account, now)) {
      throw new ConflictException({
        code: 'LISTING_COOLDOWN_ACTIVE',
        message: 'The account is in a listing cooldown period',
        cooldown_until: account.personalCooldownUntil,
      });
    }
  }

  private cooldownActive(account: AccountState, now: Date) {
    return account.personalCooldownUntil !== null && account.personalCooldownUntil > now;
  }

  private effectiveTier(account: Pick<AccountState, 'tier' | 'tierExpiresAt'>, now: Date): Tier {
    if (account.tier === Tier.PERSONAL) return Tier.PERSONAL;
    return account.tierExpiresAt !== null && account.tierExpiresAt > now ? account.tier : Tier.PERSONAL;
  }

  private async getAccount(userId: string, tx?: MarketplaceTransaction): Promise<AccountState> {
    const database = tx ?? this.prisma;
    const account = await database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tier: true,
        tierExpiresAt: true,
        phoneVerifiedAt: true,
        whatsappNumber: true,
        personalCooldownUntil: true,
      },
    });
    if (!account) throw new NotFoundException();
    return account;
  }

  private async lockAccount(tx: MarketplaceTransaction, userId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
    ) AS advisory_lock`;
  }

  private presentListing(listing: ListingWithDetails) {
    const tier = this.effectiveTier({ tier: listing.seller.tier, tierExpiresAt: listing.seller.tierExpiresAt }, new Date());
    return {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: listing.price,
      condition: listing.condition.toLowerCase(),
      status: listing.status.toLowerCase(),
      category: listing.category,
      location: {
        code: listing.region.code,
        district_code: listing.region.districtCode,
        district: listing.region.districtName,
        kelurahan: listing.region.villageName,
      },
      photos: listing.photos.map((photo) => ({ id: photo.id, url: photo.secureUrl })),
      seller: {
        id: listing.seller.id,
        display_name: listing.seller.displayName,
        avatar_url: listing.seller.avatarUrl,
        tier: tier.toLowerCase(),
        verified_store: listing.seller.verifiedStore,
        shop: listing.shop,
        whatsapp_url: listing.seller.whatsappNumber
          ? `https://wa.me/${listing.seller.whatsappNumber.replace(/^\+/, '')}`
          : null,
      },
      expires_at: listing.expiresAt,
      suspended_at: listing.suspendedAt,
      suspension_reason: listing.suspensionReason?.toLowerCase() ?? null,
      moderation_hidden_at: listing.moderationHiddenAt,
      moderation_reason: listing.moderationReason,
      created_at: listing.createdAt,
      updated_at: listing.updatedAt,
    };
  }

  private presentShop(shop: {
    id: string;
    name: string;
    description: string | null;
    verificationStatus: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: shop.id,
      name: shop.name,
      description: shop.description,
      verification_status: shop.verificationStatus.toLowerCase(),
      created_at: shop.createdAt,
      updated_at: shop.updatedAt,
    };
  }

  private presentMediaAsset(asset: {
    id: string;
    secureUrl: string | null;
    format: string | null;
    bytes: number | null;
    uploadedAt: Date | null;
  }) {
    return {
      id: asset.id,
      url: asset.secureUrl,
      format: asset.format,
      bytes: asset.bytes,
      uploaded_at: asset.uploadedAt,
    };
  }


  private isUniqueConstraintError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
