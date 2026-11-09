import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MarketplaceModule } from './marketplace/marketplace.module';

@Module({ imports: [ConfigModule, HealthModule, AuthModule, UsersModule, MarketplaceModule] })
export class AppModule {}
