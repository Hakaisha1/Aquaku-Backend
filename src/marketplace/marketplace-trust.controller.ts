import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, RolesGuard, VerifiedPhoneGuard } from '../auth/auth.guards';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthenticatedUser } from '../auth/auth.service';
import { ReportStatus } from '../generated/prisma/client';
import {
  CorrectSaleBuyerDto,
  CreateRatingDto,
  CreateReportDto,
  CreateSaleAssignmentDto,
  ModerateListingDto,
  ReportListQueryDto,
  RespondToSaleDto,
  ReviewReportDto,
} from './marketplace-trust.dto';
import { MarketplaceTrustService } from './marketplace-trust.service';

@Controller('marketplace')
export class MarketplaceTrustController {
  constructor(private readonly trust: MarketplaceTrustService) {}

  @Post('listings/:listingId/sale')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async assignBuyer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', new ParseUUIDPipe()) listingId: string,
    @Body() body: CreateSaleAssignmentDto,
  ) {
    return { data: await this.trust.assignBuyer(user, listingId, body.buyer_id) };
  }

  @Delete('sales/:saleId')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async cancelSale(
    @CurrentUser() user: AuthenticatedUser,
    @Param('saleId', new ParseUUIDPipe()) saleId: string,
  ) {
    return { data: await this.trust.cancelSale(user, saleId) };
  }

  @Get('admin/sales/:saleId/corrections')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async listSaleCorrections(@Param('saleId', new ParseUUIDPipe()) saleId: string) {
    return { data: await this.trust.listSaleCorrections(saleId) };
  }

  @Post('admin/sales/:saleId/correct-buyer')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async correctConfirmedSaleBuyer(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('saleId', new ParseUUIDPipe()) saleId: string,
    @Body() body: CorrectSaleBuyerDto,
  ) {
    return {
      data: await this.trust.correctConfirmedSaleBuyer(admin, saleId, body.buyer_id, body.reason),
    };
  }

  @Post('sales/:saleId/respond')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async respondToSale(
    @CurrentUser() user: AuthenticatedUser,
    @Param('saleId', new ParseUUIDPipe()) saleId: string,
    @Body() body: RespondToSaleDto,
  ) {
    return { data: await this.trust.respondToSale(user, saleId, body.decision, body.note) };
  }

  @Post('sales/:saleId/rating')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createRating(
    @CurrentUser() user: AuthenticatedUser,
    @Param('saleId', new ParseUUIDPipe()) saleId: string,
    @Body() body: CreateRatingDto,
  ) {
    return { data: await this.trust.createRating(user, saleId, body.score) };
  }

  @Get('me/sales')
  @UseGuards(AccessTokenGuard)
  async listMySales(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.trust.listMySales(user, 'seller') };
  }

  @Get('me/purchases')
  @UseGuards(AccessTokenGuard)
  async listMyPurchases(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.trust.listMySales(user, 'buyer') };
  }

  @Post('reports')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createReport(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateReportDto) {
    return { data: await this.trust.createReport(user, body) };
  }

  @Get('me/reports')
  @UseGuards(AccessTokenGuard)
  async listMyReports(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.trust.listMyReports(user) };
  }

  @Get('admin/reports')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async listAdminReports(@Query() query: ReportListQueryDto) {
    return { data: await this.trust.listAdminReports(query.status as ReportStatus | undefined) };
  }

  @Post('admin/reports/:reportId/review')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async reviewReport(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('reportId', new ParseUUIDPipe()) reportId: string,
    @Body() body: ReviewReportDto,
  ) {
    return { data: await this.trust.reviewReport(admin, reportId, body.decision, body.review_note) };
  }

  @Get('admin/listings/:listingId/moderation')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async listModerationActions(@Param('listingId', new ParseUUIDPipe()) listingId: string) {
    return { data: await this.trust.listModerationActions(listingId) };
  }

  @Post('admin/listings/:listingId/moderation')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async moderateListing(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('listingId', new ParseUUIDPipe()) listingId: string,
    @Body() body: ModerateListingDto,
  ) {
    return { data: await this.trust.moderateListing(admin, listingId, body) };
  }
}
