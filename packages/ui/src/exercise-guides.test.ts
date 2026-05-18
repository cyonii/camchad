import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { movementRegistry } from '@camchad/movement-core';
import { describe, expect, it } from 'vitest';

const guideDirectories = ['apps/web/public/exercise-guides', 'apps/desktop/public/exercise-guides'];

describe('exercise guide assets', () => {
  it('ships one readable guide GIF per registered movement in each runtime', () => {
    for (const directory of guideDirectories) {
      for (const definition of movementRegistry) {
        const filename = `${definition.type.replaceAll('_', '-')}-guide.gif`;
        const path = join(process.cwd(), directory, filename);

        expect(existsSync(path), `${directory}/${filename} is missing`).toBe(true);
        expect(statSync(path).size, `${directory}/${filename} is empty`).toBeGreaterThan(1024);
      }
    }
  });
});
