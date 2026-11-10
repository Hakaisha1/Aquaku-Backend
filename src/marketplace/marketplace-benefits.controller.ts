import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AccessTokenGuard, RolesGuard, VerifiedPhoneGuard } from '../auth/auth.guards';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { AuthenticatedUser } from '../auth/auth.service';
import { BenefitRequestStatus } from '../generated/prisma/client';
import {
  CreateAddonRequestDto,
  CreateMembershipRequestDto,
  RequestBenefitQueryDto,
  ReviewBenefitRequestDto,
} from './marketplace-benefits.dto';
import { MarketplaceBenefitsService } from './marketplace-benefits.service';

const proofUploadOptions = { limits: { fileSize: 5 * 1024 * 1024, files: 1 } };

@Controller('marketplace')
export class MarketplaceBenefitsController {
  constructor(private readonly benefits: MarketplaceBenefitsService) {}

  @Get('membership/plans')
  async getPlans() {
    return { data: this.benefits.getPlans() };
  }

  @Post('me/membership-requests')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  @UseInterceptors(FileInterceptor('proof', proofUploadOptions))
  async createMembershipRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateMembershipRequestDto,
    @UploadedFile() proof: { buffer: Buffer; size: number } | undefined,
  ) {
    return { data: await this.benefits.createMembershipRequest(user, body, proof) };
  }

  @Post('me/addon-requests')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  @UseInterceptors(FileInterceptor('proof', proofUploadOptions))
  async createAddonRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAddonRequestDto,
    @UploadedFile() proof: { buffer: Buffer; size: number } | undefined,
  ) {
    return { data: await this.benefits.createAddonRequest(user, body, proof) };
  }

  @Post('me/shops/verification-requests')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createShopVerificationRequest(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.benefits.createShopVerificationRequest(user) };
  }

  @Get('me/benefit-requests')
  @UseGuards(AccessTokenGuard)
  async listOwnRequests(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.benefits.listOwnRequests(user) };
  }

  @Get('me/entitlements')
  @UseGuards(AccessTokenGuard)
  async getEntitlements(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.benefits.getEntitlements(user) };
  }

  @Get('admin/benefit-requests')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async listAdminRequests(@Query() query: RequestBenefitQueryDto) {
    return { data: await this.benefits.listAdminRequests(query.status as BenefitRequestStatus | undefined) };
  }

  @Get('admin/benefit-requests/:requestId/proof')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async getPrivateProof(
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Res() response: Response,
  ) {
    const proof = await this.benefits.getPrivateProof(requestId);
    response.setHeader('Content-Type', proof.mimeType);
    response.setHeader('Content-Disposition', 'attachment; filename="transfer-proof"');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(proof.bytes);
  }

  @Post('admin/benefit-requests/:requestId/review')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('admin')
  async reviewRequest(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: ReviewBenefitRequestDto,
  ) {
    return { data: await this.benefits.reviewRequest(admin, requestId, body) };
  }
}
