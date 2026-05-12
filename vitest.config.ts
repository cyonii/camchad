import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@home-workout/pose-core': `${root}packages/pose-core/src/index.ts`,
      '@home-workout/movement-core': `${root}packages/movement-core/src/index.ts`,
      '@home-workout/workout-history': `${root}packages/workout-history/src/index.ts`,
      '@home-workout/ui': `${root}packages/ui/src/index.ts`,
    },
  },
});
