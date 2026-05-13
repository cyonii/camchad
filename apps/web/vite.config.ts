import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default {
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@camchad/ui/styles.css', replacement: `${root}/packages/ui/src/styles.css` },
      { find: '@camchad/ui', replacement: `${root}/packages/ui/src/index.ts` },
      { find: '@camchad/pose-core', replacement: `${root}/packages/pose-core/src/index.ts` },
      {
        find: '@camchad/movement-core',
        replacement: `${root}/packages/movement-core/src/index.ts`,
      },
      {
        find: '@camchad/activity-history',
        replacement: `${root}/packages/activity-history/src/index.ts`,
      },
    ],
  },
  server: {
    port: 5173,
    strictPort: false,
  },
};
