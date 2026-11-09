import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard, VerifiedPhoneGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthenticatedUser } from '../auth/auth.service';

import {
  ConfirmUploadDto,
  CreateListingDto,
  CreateShopDto,
  ListingSearchDto,
  MyListingsQueryDto,
  UpdateListingDto,
} from './marketplace.dto';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('regions')
  async getRegions() {
    return { data: await this.marketplace.getRegions() };
  }

  @Get('taxonomy')
  async getTaxonomy() {
    return { data: await this.marketplace.getTaxonomy() };
  }

  @Get('listings')
  async listListings(@Query() query: ListingSearchDto) {
    return { data: await this.marketplace.listListings(query) };
  }

  @Get('listings/:listingId')
  async getListing(@Param('listingId', new ParseUUIDPipe()) listingId: string) {
    return { data: await this.marketplace.getListing(listingId) };
  }

  @Post('shops')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createShop(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateShopDto) {
    return { data: await this.marketplace.createShop(user, body) };
  }

  @Get('me/listings')
  @UseGuards(AccessTokenGuard)
  async listMyListings(@CurrentUser() user: AuthenticatedUser, @Query() query: MyListingsQueryDto) {
    return { data: await this.marketplace.listMyListings(user, query.page ?? 1, query.limit ?? 20) };
  }

  @Get('shops/me')
  @UseGuards(AccessTokenGuard)
  async getMyShop(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.marketplace.getMyShop(user) };
  }

  @Post('media/upload-signatures')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createUploadSignature(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.marketplace.createUploadSignature(user) };
  }

  @Post('media/confirm-upload')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async confirmUpload(@CurrentUser() user: AuthenticatedUser, @Body() body: ConfirmUploadDto) {
    return { data: await this.marketplace.confirmUpload(user, body.asset_id) };
  }

  @Delete('media/:assetId')
  @UseGuards(AccessTokenGuard)
  async deleteMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
  ) {
    return { data: await this.marketplace.deleteMediaAsset(user, assetId) };
  }

  @Post('listings')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async createListing(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateListingDto) {
    return { data: await this.marketplace.createListing(user, body) };
  }

  @Patch('listings/:listingId')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async updateListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', new ParseUUIDPipe()) listingId: string,
    @Body() body: UpdateListingDto,
  ) {
    return { data: await this.marketplace.updateListing(user, listingId, body) };
  }

  @Post('listings/:listingId/sold')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async markSold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', new ParseUUIDPipe()) listingId: string,
  ) {
    return { data: await this.marketplace.markSold(user, listingId) };
  }

  @Delete('listings/:listingId')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async deleteListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', new ParseUUIDPipe()) listingId: string,
  ) {
    return { data: await this.marketplace.deleteListing(user, listingId) };
  }

  @Post('listings/:listingId/renew')
  @UseGuards(AccessTokenGuard, VerifiedPhoneGuard)
  async renewListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', new ParseUUIDPipe()) listingId: string,
  ) {
    return { data: await this.marketplace.renewListing(user, listingId) };
  }

  @Get('me/quota')
  @UseGuards(AccessTokenGuard)
  async getQuota(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.marketplace.getQuota(user) };
  }
}
