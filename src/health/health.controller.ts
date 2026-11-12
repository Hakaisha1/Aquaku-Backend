import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectConnection() private readonly mongo: Connection,
  ) {}

  @Get('live')
  live() {
    return { data: { status: 'ok' } };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (this.mongo.readyState !== 1 || !this.mongo.db) throw new Error('MongoDB unavailable');
      await this.mongo.db.admin().ping();
      return { data: { status: 'ready', checks: { database: 'up', forum_database: 'up' } } };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
