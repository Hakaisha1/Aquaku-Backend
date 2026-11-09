import { Injectable } from '@nestjs/common';

export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpSender {
  send(phoneNumber: string, code: string): Promise<void>;
}

@Injectable()
export class DevelopmentOtpSender implements OtpSender {
  async send(): Promise<void> {
    // Development codes are returned by the local registration/resend response.
  }
}

@Injectable()
export class FakeOtpSender implements OtpSender {
  readonly sent: Array<{ phoneNumber: string; code: string }> = [];

  async send(phoneNumber: string, code: string): Promise<void> {
    this.sent.push({ phoneNumber, code });
  }
}
