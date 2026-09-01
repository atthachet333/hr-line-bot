import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('PM2 production configuration', () => {
  it('starts the canonical repository with next start on port 3333', () => {
    const config = require('../ecosystem.config.cjs') as {
      apps: Array<{ name: string; cwd: string; script: string; args: string; interpreter: string }>;
    };
    const app = config.apps.find((candidate) => candidate.name === 'hr-line-bot');
    expect(app).toMatchObject({
      cwd: 'D:\\S2A_PROJECT\\hr-line-bot',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3333',
      interpreter: 'node',
    });
  });
});
