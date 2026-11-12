import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from './config/config.module';
import { RUNTIME_CONFIG, RuntimeConfig } from './config/runtime-config';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { ForumModule } from './forum/forum.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) => ({
        uri: config.mongoUri,
        lazyConnection: true,
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    MarketplaceModule,
    ForumModule,
  ],
})
export class AppModule {}
