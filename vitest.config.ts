import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@camchad/activity-history': `${root}packages/activity-history/src/index.ts`,
      '@camchad/movement-core': `${root}packages/movement-core/src/index.ts`,
      '@camchad/pose-core': `${root}packages/pose-core/src/index.ts`,
      '@camchad/ui': `${root}packages/ui/src/index.ts`,
    },
  },
});
