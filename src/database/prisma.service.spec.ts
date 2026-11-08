import { PrismaService } from './prisma.service';

describe('PrismaService lifecycle', () => {
  it('disconnects the client during application shutdown', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    await PrismaService.prototype.onModuleDestroy.call({ $disconnect: disconnect } as unknown as PrismaService);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
