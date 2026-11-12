import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard, RolesGuard, VerifiedPhoneGuard } from './auth.guards';
import { DevelopmentOtpSender, FakeOtpSender, OTP_SENDER } from './otp-sender';
import { OtpIdService } from './otp-id.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpIdService,
    AccessTokenGuard,
    RolesGuard,
    VerifiedPhoneGuard,
    {
      provide: OTP_SENDER,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) => config.appEnv === 'test'
        ? new FakeOtpSender()
        : new DevelopmentOtpSender(),
    },
  ],
  exports: [AuthService, AccessTokenGuard, RolesGuard, VerifiedPhoneGuard],
})
export class AuthModule {}
