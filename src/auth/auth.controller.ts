import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto, VerifyPhoneDto } from './auth.dto';
import { AccessTokenGuard } from './auth.guards';
import { CurrentUser } from './auth.decorators';
import { AuthenticatedUser } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto) {
    const result = await this.authService.register(body);
    return {
      data: result.user,
      ...(result.development_otp ? { development_otp: result.development_otp } : {}),
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto) {
    return { data: await this.authService.login(body) };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshDto) {
    return { data: await this.authService.refresh(body.refresh_token) };
  }

  @Post('verify-phone')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  async verifyPhone(@CurrentUser() user: AuthenticatedUser, @Body() body: VerifyPhoneDto) {
    return { data: await this.authService.verifyPhone(user.id, body.code) };
  }

  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  async resendOtp(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.authService.resendOtp(user.id) };
  }
}
