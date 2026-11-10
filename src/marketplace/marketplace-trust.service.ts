import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingModerationAction,
  ListingStatus,
  Prisma,
  ReportReason,
  ReportStatus,
  SaleTransactionStatus,
} from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.service';
import { PrismaService } from '../database/prisma.service';
import {
  CreateReportDto,
  ModerateListingDto,
} from './marketplace-trust.dto';

const saleSelect = {
  id: true,
  listingId: true,
  sellerId: true,
  buyerId: true,
  status: true,
  responseNote: true,
  respondedAt: true,
  createdAt: true,
  listing: { select: { id: true, title: true, price: true } },
  seller: { select: { id: true, displayName: true } },
  buyer: { select: { id: true, displayName: true } },
  rating: { select: { id: true, score: true, createdAt: true } },
} satisfies Prisma.SaleTransactionSelect;

const reportSelect = {
  id: true,
  reporterId: true,
  targetListingId: true,
  targetUserId: true,
  reason: true,
  details: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  reporter: { select: { id: true, displayName: true } },
  targetListing: { select: { id: true, title: true, status: true, moderationHiddenAt: true } },
  targetUser: { select: { id: true, displayName: true } },
  reviewer: { select: { id: true, displayName: true } },
} satisfies Prisma.ReportSelect;

type TrustTransaction = Prisma.TransactionClient;

@Injectable()
export class MarketplaceTrustService {
  constructor(private readonly prisma: PrismaService) {}

  async assignBuyer(user: AuthenticatedUser, listingId: string, buyerId: string) {
    this.assertVerifiedPhone(user);
    if (buyerId === user.id) throw new BadRequestException('Seller cannot be the transaction buyer');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAccount(tx, user.id);
        const listing = await tx.listing.findFirst({
          where: { id: listingId, sellerId: user.id, status: ListingStatus.SOLD, deletedAt: null },
          select: { id: true },
        });
        if (!listing) throw new NotFoundException();
        await this.assertVerifiedBuyer(tx, buyerId);
        let active = await tx.saleTransaction.findFirst({
          where: {
            listingId,
            status: { in: [SaleTransactionStatus.AWAITING_CONFIRMATION, SaleTransactionStatus.CONFIRMED] },
          },
          select: { id: true, buyerId: true, status: true },
          orderBy: { createdAt: 'desc' },
        });
        if (active) {
          await this.lockSale(tx, active.id);
          active = await tx.saleTransaction.findUnique({
            where: { id: active.id },
            select: { id: true, buyerId: true, status: true },
          });
        }
        if (active?.status === SaleTransactionStatus.CONFIRMED) {
          throw new ConflictException('A confirmed transaction cannot be reassigned');
        }
        if (active?.status === SaleTransactionStatus.AWAITING_CONFIRMATION) {
          if (active.buyerId === buyerId) {
            const same = await tx.saleTransaction.findUniqueOrThrow({ where: { id: active.id }, select: saleSelect });
            return this.presentSale(same);
          }
          await tx.saleTransaction.update({
            where: { id: active.id },
            data: {
              status: SaleTransactionStatus.CANCELLED,
              responseNote: 'Seller changed the selected buyer before confirmation',
              respondedAt: new Date(),
            },
          });
        }
        const sale = await tx.saleTransaction.create({
          data: {
            listingId,
            sellerId: user.id,
            buyerId,
            status: SaleTransactionStatus.AWAITING_CONFIRMATION,
          },
          select: saleSelect,
        });
        return this.presentSale(sale);
      }, { timeout: 10_000 });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('This listing already has an active buyer confirmation');
      throw error;
    }
  }

  async cancelSale(user: AuthenticatedUser, saleId: string) {
    this.assertVerifiedPhone(user);
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.saleTransaction.findUnique({ where: { id: saleId }, select: { sellerId: true } });
      if (!initial) throw new NotFoundException();
      if (initial.sellerId !== user.id) throw new ForbiddenException();
      await this.lockAccount(tx, user.id);
      await this.lockSale(tx, saleId);
      const sale = await tx.saleTransaction.findUnique({ where: { id: saleId }, select: saleSelect });
      if (!sale) throw new NotFoundException();
      if (sale.status === SaleTransactionStatus.CANCELLED) return this.presentSale(sale);
      if (sale.status !== SaleTransactionStatus.AWAITING_CONFIRMATION) {
        throw new ConflictException('Only an awaiting buyer confirmation can be cancelled');
      }
      const updated = await tx.saleTransaction.update({
        where: { id: saleId },
        data: {
          status: SaleTransactionStatus.CANCELLED,
          responseNote: 'Seller cancelled before buyer confirmation',
          respondedAt: new Date(),
        },
        select: saleSelect,
      });
      return this.presentSale(updated);
    });
  }

  async correctConfirmedSaleBuyer(
    admin: AuthenticatedUser,
    saleId: string,
    buyerId: string,
    reason: string,
  ) {
    const correctionReason = reason.trim();
    if (!correctionReason) throw new BadRequestException('A correction reason is required');
    return this.prisma.$transaction(async (tx) => {
      await this.lockSale(tx, saleId);
      const sale = await tx.saleTransaction.findUnique({
        where: { id: saleId },
        select: { id: true, sellerId: true, buyerId: true, status: true },
      });
      if (!sale) throw new NotFoundException();
      if (sale.status === SaleTransactionStatus.AWAITING_CONFIRMATION && sale.buyerId === buyerId) {
        const previousCorrection = await tx.saleTransactionCorrection.findFirst({
          where: { saleTransactionId: saleId, newBuyerId: buyerId },
          orderBy: { createdAt: 'desc' },
        });
        if (previousCorrection) {
          return this.presentSale(await tx.saleTransaction.findUniqueOrThrow({ where: { id: saleId }, select: saleSelect }));
        }
      }
      if (sale.status !== SaleTransactionStatus.CONFIRMED) {
        throw new ConflictException('Only a confirmed transaction can be corrected by an admin');
      }
      if (buyerId === sale.sellerId || buyerId === sale.buyerId) {
        throw new BadRequestException('The corrected buyer must be a different account from the seller and current buyer');
      }
      await this.assertVerifiedBuyer(tx, buyerId);
      await tx.rating.deleteMany({ where: { saleTransactionId: saleId } });
      const updated = await tx.saleTransaction.update({
        where: { id: saleId },
        data: {
          buyerId,
          status: SaleTransactionStatus.AWAITING_CONFIRMATION,
          responseNote: null,
          respondedAt: null,
        },
        select: saleSelect,
      });
      await tx.saleTransactionCorrection.create({
        data: {
          saleTransactionId: saleId,
          adminId: admin.id,
          previousBuyerId: sale.buyerId,
          newBuyerId: buyerId,
          reason: correctionReason,
        },
      });
      return this.presentSale(updated);
    }, { timeout: 10_000 });
  }

  async listSaleCorrections(saleId: string) {
    const sale = await this.prisma.saleTransaction.findUnique({ where: { id: saleId }, select: { id: true } });
    if (!sale) throw new NotFoundException();
    const corrections = await this.prisma.saleTransactionCorrection.findMany({
      where: { saleTransactionId: saleId },
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        admin: { select: { id: true, displayName: true } },
        previousBuyer: { select: { id: true, displayName: true } },
        newBuyer: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return corrections.map((correction) => ({
      id: correction.id,
      action: correction.action.toLowerCase(),
      reason: correction.reason,
      admin: { id: correction.admin.id, display_name: correction.admin.displayName },
      previous_buyer: { id: correction.previousBuyer.id, display_name: correction.previousBuyer.displayName },
      new_buyer: { id: correction.newBuyer.id, display_name: correction.newBuyer.displayName },
      created_at: correction.createdAt,
    }));
  }

  async respondToSale(user: AuthenticatedUser, saleId: string, decision: 'CONFIRM' | 'REJECT', note?: string) {
    this.assertVerifiedPhone(user);
    return this.prisma.$transaction(async (tx) => {
      await this.lockSale(tx, saleId);
      const sale = await tx.saleTransaction.findUnique({ where: { id: saleId }, select: saleSelect });
      if (!sale) throw new NotFoundException();
      if (sale.buyerId !== user.id) throw new ForbiddenException();
      const targetStatus = decision === 'CONFIRM'
        ? SaleTransactionStatus.CONFIRMED
        : SaleTransactionStatus.REJECTED;
      if (sale.status !== SaleTransactionStatus.AWAITING_CONFIRMATION) {
        if (sale.status === targetStatus) return this.presentSale(sale);
        throw new ConflictException('This transaction has already been answered');
      }
      const updated = await tx.saleTransaction.update({
        where: { id: saleId },
        data: {
          status: targetStatus,
          responseNote: note?.trim() || null,
          respondedAt: new Date(),
        },
        select: saleSelect,
      });
      return this.presentSale(updated);
    }, { timeout: 10_000 });
  }

  async createRating(user: AuthenticatedUser, saleId: string, score: number) {
    this.assertVerifiedPhone(user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockSale(tx, saleId);
        const sale = await tx.saleTransaction.findUnique({
          where: { id: saleId },
          select: { id: true, buyerId: true, sellerId: true, status: true },
        });
        if (!sale) throw new NotFoundException();
        if (sale.buyerId !== user.id) throw new ForbiddenException();
        if (sale.status !== SaleTransactionStatus.CONFIRMED) {
          throw new ConflictException('Only a confirmed transaction can be rated');
        }
        const existing = await tx.rating.findUnique({
          where: { saleTransactionId: sale.id },
          select: { id: true, score: true, createdAt: true },
        });
        if (existing) {
          if (existing.score !== score) throw new ConflictException('A rating for this transaction already exists');
          return this.presentRating(existing);
        }
        const rating = await tx.rating.create({
          data: { saleTransactionId: sale.id, buyerId: user.id, sellerId: sale.sellerId, score },
          select: { id: true, score: true, createdAt: true },
        });
        return this.presentRating(rating);
      }, { timeout: 10_000 });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('A rating for this transaction already exists');
      throw error;
    }
  }

  async listMySales(user: AuthenticatedUser, role: 'buyer' | 'seller') {
    const rows = await this.prisma.saleTransaction.findMany({
      where: role === 'seller' ? { sellerId: user.id } : { buyerId: user.id },
      select: saleSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.presentSale(row));
  }

  async createReport(user: AuthenticatedUser, input: CreateReportDto) {
    this.assertVerifiedPhone(user);
    const targetListingId = input.target_type === 'LISTING' ? input.target_id : null;
    const targetUserId = input.target_type === 'USER' ? input.target_id : null;
    if (targetUserId === user.id) throw new BadRequestException('Users cannot report themselves');
    try {
      const report = await this.prisma.$transaction(async (tx) => {
        if (targetListingId) {
          const listing = await tx.listing.findUnique({
            where: { id: targetListingId },
            select: { sellerId: true, deletedAt: true },
          });
          if (!listing || listing.deletedAt) throw new NotFoundException();
          if (listing.sellerId === user.id) throw new BadRequestException('Users cannot report their own listing');
        } else if (targetUserId) {
          const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
          if (!target) throw new NotFoundException();
        }
        return tx.report.create({
          data: {
            reporterId: user.id,
            targetListingId,
            targetUserId,
            reason: input.reason as ReportReason,
            details: input.details?.trim() || null,
          },
          select: reportSelect,
        });
      });
      return this.presentReport(report);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('An open report for this target already exists from this account');
      }
      throw error;
    }
  }

  async listMyReports(user: AuthenticatedUser) {
    const reports = await this.prisma.report.findMany({
      where: { reporterId: user.id },
      select: reportSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reports.map((report) => this.presentReport(report));
  }

  async listAdminReports(status?: ReportStatus) {
    const reports = await this.prisma.report.findMany({
      where: status ? { status } : undefined,
      select: reportSelect,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    return reports.map((report) => this.presentReport(report));
  }

  async reviewReport(admin: AuthenticatedUser, reportId: string, decision: 'RESOLVED' | 'DISMISSED', note: string) {
    const reviewNote = note.trim();
    if (!reviewNote) throw new BadRequestException('A review note is required');
    return this.prisma.$transaction(async (tx) => {
      await this.lockReport(tx, reportId);
      const report = await tx.report.findUnique({ where: { id: reportId } });
      if (!report) throw new NotFoundException();
      if (report.status !== ReportStatus.OPEN) {
        if (report.status === decision) return this.presentReport(await tx.report.findUniqueOrThrow({
          where: { id: reportId }, select: reportSelect,
        }));
        throw new ConflictException('This report has already been reviewed');
      }
      const updated = await tx.report.update({
        where: { id: reportId },
        data: {
          status: decision,
          reviewedById: admin.id,
          reviewNote,
          reviewedAt: new Date(),
        },
        select: reportSelect,
      });
      return this.presentReport(updated);
    });
  }

  async listModerationActions(listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) throw new NotFoundException();
    const actions = await this.prisma.moderationAction.findMany({
      where: { listingId },
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        admin: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return actions.map((action) => ({
      id: action.id,
      action: action.action.toLowerCase(),
      reason: action.reason,
      admin: { id: action.admin.id, display_name: action.admin.displayName },
      created_at: action.createdAt,
    }));
  }

  async moderateListing(admin: AuthenticatedUser, listingId: string, input: ModerateListingDto) {
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('A moderation reason is required');
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } });
      if (!initial) throw new NotFoundException();
      await this.lockAccount(tx, initial.sellerId);
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          expiresAt: true,
          moderationHiddenAt: true,
          moderationReason: true,
        },
      });
      if (!listing || listing.deletedAt) throw new NotFoundException();
      if (input.action === 'HIDE') {
        if (listing.moderationHiddenAt) {
          return { id: listing.id, hidden: true, moderation_reason: listing.moderationReason };
        }
        if (listing.status !== ListingStatus.ACTIVE || listing.expiresAt <= new Date()) {
          throw new ConflictException('Only a publicly active listing can be hidden');
        }
        const now = new Date();
        await tx.listing.update({
          where: { id: listing.id },
          data: { moderationHiddenAt: now, moderationReason: reason },
        });
        await tx.moderationAction.create({
          data: { listingId: listing.id, adminId: admin.id, action: ListingModerationAction.HIDE, reason },
        });
        return { id: listing.id, hidden: true, moderation_reason: reason };
      }
      if (!listing.moderationHiddenAt) throw new ConflictException('Listing is not hidden by moderation');
      await tx.listing.update({
        where: { id: listing.id },
        data: { moderationHiddenAt: null, moderationReason: null },
      });
      await tx.moderationAction.create({
        data: { listingId: listing.id, adminId: admin.id, action: ListingModerationAction.RESTORE, reason },
      });
      return { id: listing.id, hidden: false, moderation_reason: null };
    }, { timeout: 10_000 });
  }

  private async assertVerifiedBuyer(tx: TrustTransaction, buyerId: string) {
    const buyer = await tx.user.findUnique({ where: { id: buyerId }, select: { phoneVerifiedAt: true } });
    if (!buyer) throw new NotFoundException('Buyer account not found');
    if (!buyer.phoneVerifiedAt) throw new ForbiddenException('Buyer phone verification required');
  }

  private assertVerifiedPhone(user: AuthenticatedUser) {
    if (!user.phoneVerified) throw new ForbiddenException('Phone verification required');
  }

  private async lockReport(tx: TrustTransaction, reportId: string) {
    await tx.$queryRaw`SELECT "id" FROM "reports" WHERE "id" = ${reportId} FOR UPDATE`;
  }

  private async lockSale(tx: TrustTransaction, saleId: string) {
    await tx.$queryRaw`SELECT "id" FROM "sale_transactions" WHERE "id" = ${saleId} FOR UPDATE`;
  }

  private async lockAccount(tx: TrustTransaction, userId: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
    ) AS advisory_lock`;
  }

  private presentSale(sale: {
    id: string;
    listingId: string;
    sellerId: string;
    buyerId: string;
    status: SaleTransactionStatus;
    responseNote: string | null;
    respondedAt: Date | null;
    createdAt: Date;
    listing: { id: string; title: string; price: number };
    seller: { id: string; displayName: string };
    buyer: { id: string; displayName: string };
    rating: { id: string; score: number; createdAt: Date } | null;
  }) {
    return {
      id: sale.id,
      listing: sale.listing,
      seller: { id: sale.seller.id, display_name: sale.seller.displayName },
      buyer: { id: sale.buyer.id, display_name: sale.buyer.displayName },
      status: sale.status.toLowerCase(),
      response_note: sale.responseNote,
      responded_at: sale.respondedAt,
      rating: sale.rating ? this.presentRating(sale.rating) : null,
      created_at: sale.createdAt,
    };
  }

  private presentRating(rating: { id: string; score: number; createdAt: Date }) {
    return { id: rating.id, score: rating.score, created_at: rating.createdAt };
  }

  private presentReport(report: {
    id: string;
    reporterId: string;
    targetListingId: string | null;
    targetUserId: string | null;
    reason: ReportReason;
    details: string | null;
    status: ReportStatus;
    reviewNote: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    reporter: { id: string; displayName: string };
    targetListing: { id: string; title: string; status: ListingStatus; moderationHiddenAt: Date | null } | null;
    targetUser: { id: string; displayName: string } | null;
    reviewer: { id: string; displayName: string } | null;
  }) {
    return {
      id: report.id,
      reporter: { id: report.reporter.id, display_name: report.reporter.displayName },
      target: report.targetListing
        ? { type: 'listing', id: report.targetListing.id, title: report.targetListing.title }
        : report.targetUser
          ? { type: 'user', id: report.targetUser.id, display_name: report.targetUser.displayName }
          : null,
      reason: report.reason.toLowerCase(),
      details: report.details,
      status: report.status.toLowerCase(),
      review_note: report.reviewNote,
      reviewed_by: report.reviewer
        ? { id: report.reviewer.id, display_name: report.reviewer.displayName }
        : null,
      reviewed_at: report.reviewedAt,
      listing_hidden: report.targetListing?.moderationHiddenAt !== null && report.targetListing?.moderationHiddenAt !== undefined,
      created_at: report.createdAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
