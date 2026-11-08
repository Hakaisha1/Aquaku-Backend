import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const query = jest.fn();
  const controller = new HealthController({ $queryRaw: query } as unknown as PrismaService);

  beforeEach(() => query.mockReset());

  it('reports liveness without querying the database', () => {
    expect(controller.live()).toEqual({ data: { status: 'ok' } });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports readiness after a database query succeeds', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);
    await expect(controller.ready()).resolves.toEqual({
      data: { status: 'ready', checks: { database: 'up' } },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not expose database details when readiness fails', async () => {
    query.mockRejectedValue(new Error('private-database-password'));
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
