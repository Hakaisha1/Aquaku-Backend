import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenGuard, RolesGuard, VerifiedPhoneGuard } from './auth.guards';
import { AuthService } from './auth.service';

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

describe('authentication guards', () => {
  it('rejects a request without a bearer token', async () => {
    const guard = new AccessTokenGuard({
      authenticateAccessToken: jest.fn(),
    } as unknown as AuthService);
    await expect(guard.canActivate(context({ headers: {} })))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the current account after validating a bearer token', async () => {
    const identity = { id: 'user-id', role: 'member' as const, phoneVerified: false };
    const authenticateAccessToken = jest.fn().mockResolvedValue(identity);
    const guard = new AccessTokenGuard({ authenticateAccessToken } as unknown as AuthService);
    const request = { headers: { authorization: 'Bearer signed.token.value' } };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(authenticateAccessToken).toHaveBeenCalledWith('signed.token.value');
    expect(request).toHaveProperty('user', identity);
  });

  it('blocks phone-dependent actions until phone verification', () => {
    const guard = new VerifiedPhoneGuard();
    expect(() => guard.canActivate(context({ user: { phoneVerified: false } })))
      .toThrow(ForbiddenException);
    expect(guard.canActivate(context({ user: { phoneVerified: true } }))).toBe(true);
  });

  it('enforces role metadata and denies non-admin accounts', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['admin']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(context({ user: { role: 'member' } })))
      .toThrow(ForbiddenException);
    expect(guard.canActivate(context({ user: { role: 'admin' } }))).toBe(true);
  });
});
