import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';
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
    ThrottlerModule.forRoot([
      {
        ttl: seconds(60),
        limit: 100,
      },
    ]),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) => ({
        uri: config.mongoUri,
        dbName: 'aquaku',
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
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
