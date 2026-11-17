import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, seconds } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto, VerifyPhoneDto } from './auth.dto';
import { AccessTokenGuard } from './auth.guards';
import { CurrentUser } from './auth.decorators';
import { AuthenticatedUser } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  async register(@Body() body: RegisterDto) {
    const result = await this.authService.register(body);
    return {
      data: result.user,
      ...(result.development_otp ? { development_otp: result.development_otp } : {}),
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  async login(@Body() body: LoginDto) {
    return { data: await this.authService.login(body) };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshDto) {
    return { data: await this.authService.refresh(body.refresh_token) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: RefreshDto) {
    return { data: await this.authService.logout(body.refresh_token) };
  }

  @Post(['verify-phone', 'verify-otp'])
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @UseGuards(AccessTokenGuard)
  async verifyPhone(@CurrentUser() user: AuthenticatedUser, @Body() body: VerifyPhoneDto) {
    return { data: await this.authService.verifyPhone(user.id, body.code) };
  }

  @Post(['otp/resend', 'request-otp'])
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @UseGuards(AccessTokenGuard)
  async resendOtp(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.authService.resendOtp(user.id) };
  }
}
