import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CLOUDINARY_CLIENT, CloudinaryClient } from './cloudinary-client';
import { MarketplaceBenefitsController } from './marketplace-benefits.controller';
import { MarketplaceBenefitsService } from './marketplace-benefits.service';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [MarketplaceController, MarketplaceBenefitsController],
  providers: [
    MarketplaceService,
    MarketplaceBenefitsService,
    { provide: CLOUDINARY_CLIENT, useClass: CloudinaryClient },
  ],
})
export class MarketplaceModule {}
