import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default {
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@home-workout/ui/styles.css', replacement: `${root}/packages/ui/src/styles.css` },
      { find: '@home-workout/ui', replacement: `${root}/packages/ui/src/index.ts` },
      { find: '@home-workout/pose-core', replacement: `${root}/packages/pose-core/src/index.ts` },
      {
        find: '@home-workout/exercise-core',
        replacement: `${root}/packages/exercise-core/src/index.ts`,
      },
      {
        find: '@home-workout/workout-history',
        replacement: `${root}/packages/workout-history/src/index.ts`,
      },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
};
