import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APIError, Channels, ErrorCodes, OtpIdClient } from '@otp-id/sdk';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { OTP_TTL_MILLISECONDS } from './auth-security';

export interface OtpIdRequest {
  readonly otpId: string;
  readonly status: string;
  readonly expiresAt: Date;
}

@Injectable()
export class OtpIdService {
  private readonly logger = new Logger(OtpIdService.name);
  private readonly client?: OtpIdClient;

  constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    if (config.otpIdApiKey) {
      this.client = new OtpIdClient(config.otpIdApiKey, { timeoutMs: 10_000 });
    }
  }

  get isConfigured(): boolean {
    return this.client !== undefined;
  }

  async requestPhoneOtp(phoneNumber: string, externalId: string): Promise<OtpIdRequest> {
    const client = this.requireClient();
    let result;
    try {
      result = await client.requestOtp({
        channel: Channels.WhatsApp,
        destination: phoneNumber.replace(/^\+/, ''),
        external_id: externalId,
        otp_length: 6,
        ttl: OTP_TTL_MILLISECONDS / 1000,
      });
    } catch (error: unknown) {
      throw this.toHttpException(error);
    }

    if (result.last_balance < result.price) {
      this.logger.warn(
        `OTP.ID prepaid balance is low (remaining=${result.last_balance}, next_otp_cost=${result.price})`,
      );
    }
    if (result.status === 'failed') {
      this.logger.warn('OTP.ID could not deliver a WhatsApp OTP');
    }

    return {
      otpId: result.otp_id,
      status: result.status,
      expiresAt: this.parseWibDate(result.expires_at),
    };
  }

  async verifyPhoneOtp(otpId: string, code: string): Promise<boolean> {
    try {
      return (await this.requireClient().verifyOtp(otpId, code)).verified;
    } catch (error: unknown) {
      throw this.toHttpException(error);
    }
  }

  private requireClient(): OtpIdClient {
    if (!this.client) throw new ServiceUnavailableException('OTP provider is not configured');
    return this.client;
  }

  private parseWibDate(value: string): Date {
    const parsed = new Date(`${value.replace(' ', 'T')}+07:00`);
    return Number.isNaN(parsed.getTime())
      ? new Date(Date.now() + OTP_TTL_MILLISECONDS)
      : parsed;
  }

  private toHttpException(error: unknown): Error {
    if (!(error instanceof APIError)) {
      return new ServiceUnavailableException('OTP provider unavailable');
    }

    switch (error.code) {
      case ErrorCodes.INVALID_NUMBER:
      case ErrorCodes.VALIDATION_ERROR:
        return new BadRequestException('Phone number is invalid');
      case ErrorCodes.RATE_LIMITED:
      case ErrorCodes.DESTINATION_RATE_LIMITED:
      case ErrorCodes.TOO_MANY_ATTEMPTS:
        return new HttpException('Too many OTP attempts; try again later', 429);
      case ErrorCodes.OTP_EXPIRED:
        return new BadRequestException('OTP has expired');
      case ErrorCodes.ALREADY_USED:
      case ErrorCodes.DUPLICATE_EXTERNAL_ID:
        return new ConflictException('OTP transaction is no longer usable');
      case ErrorCodes.OTP_NOT_FOUND:
        return new BadRequestException('OTP transaction was not found');
      case ErrorCodes.UNAUTHORIZED:
      case ErrorCodes.IP_NOT_ALLOWED:
      case ErrorCodes.INSUFFICIENT_BALANCE:
      case ErrorCodes.CHANNEL_UNAVAILABLE:
      case ErrorCodes.INTERNAL_ERROR:
      case ErrorCodes.INVALID_CHANNEL:
      case ErrorCodes.INVALID_RESPONSE:
      default:
        this.logger.error(`OTP.ID request failed (${error.code})`);
        return new ServiceUnavailableException('OTP provider unavailable');
    }
  }
}
