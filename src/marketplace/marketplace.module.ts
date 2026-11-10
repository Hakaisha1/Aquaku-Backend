import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CLOUDINARY_CLIENT, CloudinaryClient } from './cloudinary-client';
import { MarketplaceBenefitsController } from './marketplace-benefits.controller';
import { MarketplaceBenefitsService } from './marketplace-benefits.service';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceTrustController } from './marketplace-trust.controller';
import { MarketplaceTrustService } from './marketplace-trust.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MarketplaceController, MarketplaceBenefitsController, MarketplaceTrustController],
  providers: [
    MarketplaceService,
    MarketplaceBenefitsService,
    MarketplaceTrustService,
    { provide: CLOUDINARY_CLIENT, useClass: CloudinaryClient },
  ],
})
export class MarketplaceModule {}
