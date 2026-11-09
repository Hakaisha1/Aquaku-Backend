import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/auth.guards';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthenticatedUser } from '../auth/auth.service';
import { UpdateProfileDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.usersService.getMe(user) };
  }

  @Patch('me')
  @UseGuards(AccessTokenGuard)
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateProfileDto) {
    return { data: await this.usersService.updateMe(user, body) };
  }

  @Get(':userId')
  async getPublic(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return { data: await this.usersService.getPublic(userId) };
  }
}
