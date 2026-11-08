import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { RUNTIME_CONFIG, RuntimeConfig } from '../config/runtime-config';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(RUNTIME_CONFIG) config: RuntimeConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        max: 5,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        statement_timeout: 2000,
      }),
    });
  }

  // Connect lazily: liveness must remain available during a database outage.
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
