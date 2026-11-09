import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({ imports: [ConfigModule, HealthModule, AuthModule, UsersModule] })
export class AppModule {}
