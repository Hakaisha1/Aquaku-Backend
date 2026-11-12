import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { RuntimeConfig } from '../config/runtime-config';
import { OtpIdService } from './otp-id.service';

const apiKey = '550e8400-e29b-41d4-a716-446655440000';
const originalFetch = globalThis.fetch;

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OtpIdService', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('requests a WhatsApp OTP with a stable external ID and server-only credentials', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response({
      success: true,
      data: {
        otp_id: 'OTP20261112ABCD000001',
        status: 'sent',
        channel: 'whatsapp',
        number: '6281234567890',
        price: 350,
        last_balance: 99650,
        expires_at: '2026-11-12 10:05:00',
      },
      error: null,
    }));
    globalThis.fetch = fetchMock;
    const service = new OtpIdService({ otpIdApiKey: apiKey } as RuntimeConfig);

    const result = await service.requestPhoneOtp('+6281234567890', 'request-uuid');

    expect(result).toMatchObject({ otpId: 'OTP20261112ABCD000001', status: 'sent' });
    expect(result.expiresAt.toISOString()).toBe('2026-11-12T03:05:00.000Z');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.otp.id/v3/request',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${apiKey}` }),
        body: JSON.stringify({
          channel: 'whatsapp',
          destination: '6281234567890',
          external_id: 'request-uuid',
          otp_length: 6,
          ttl: 300,
        }),
      }),
    );
  });

  it('returns false for a normal OTP mismatch response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(response({
      success: true,
      data: { otp_id: 'OTP20261112ABCD000001', verified: false, reason: 'mismatch' },
      error: null,
    }));
    const service = new OtpIdService({ otpIdApiKey: apiKey } as RuntimeConfig);

    await expect(service.verifyPhoneOtp('OTP20261112ABCD000001', '000000')).resolves.toBe(false);
  });

  it('maps provider API errors without exposing provider response details', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(response({
      success: false,
      data: null,
      error: { code: 'INSUFFICIENT_BALANCE', message: 'private provider detail' },
    }, 402));
    const service = new OtpIdService({ otpIdApiKey: apiKey } as RuntimeConfig);

    try {
      await service.requestPhoneOtp('+6281234567890', 'request-uuid');
      throw new Error('Expected OTP provider request to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).not.toContain('private provider detail');
    }
  });

  it('logs a warning when the remaining credit cannot cover another OTP', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(response({
      success: true,
      data: {
        otp_id: 'OTP20261112ABCD000001',
        status: 'sent',
        channel: 'whatsapp',
        number: '6281234567890',
        price: 350,
        last_balance: 200,
        expires_at: '2026-11-12 10:05:00',
      },
      error: null,
    }));
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = new OtpIdService({ otpIdApiKey: apiKey } as RuntimeConfig);

    await service.requestPhoneOtp('+6281234567890', 'request-uuid');

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('OTP.ID prepaid balance is low'));
  });
});
