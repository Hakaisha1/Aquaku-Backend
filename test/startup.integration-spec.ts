import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const entrypoint = resolve(__dirname, '../dist/main.js');

function startupEnv(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_ENV: 'test', API_PREFIX: '/api/v1', PORT: '3000',
    DATABASE_URL: databaseUrl, CORS_ORIGIN: 'http://localhost:5173',
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

describe('Built application startup', () => {
  it('rejects invalid configuration without printing credentials', () => {
    const child = spawnSync(process.execPath, [entrypoint], {
      env: startupEnv('invalid://private-user:private-password@private-host/database'),
      encoding: 'utf8', timeout: 5000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(child.stderr).toContain('Invalid configuration fields: DATABASE_URL');
    expect(`${child.stdout}${child.stderr}`).not.toContain('private-');
  });

  it('starts the built server and serves real database readiness', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) {
      throw new Error('TEST_DATABASE_URL must target a dedicated database ending in _test');
    }
    const port = await freePort();
    const child = spawn(process.execPath, [entrypoint], {
      env: { ...startupEnv(databaseUrl), PORT: String(port) },
      stdio: 'ignore',
    });
    const closed = new Promise<void>((resolve, reject) => {
      child.once('close', () => resolve());
      child.once('error', reject);
    });
    const url = `http://127.0.0.1:${port}/api/v1/health/ready`;
    try {
      const deadline = Date.now() + 10000;
      let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('Built application exited before readiness');
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
          if (response.ok) {
            expect(await response.json()).toEqual({
              data: { status: 'ready', checks: { database: 'up' } },
            });
            ready = true;
            break;
          }
        } catch {
          // Allow the child time to bind its HTTP port during startup.
        }
        await delay(100);
      }
      expect(ready).toBe(true);
    } finally {
      child.kill();
      await closed;
    }
  });
});
