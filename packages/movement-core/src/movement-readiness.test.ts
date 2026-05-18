import { describe, expect, it } from 'vitest';

import { movementDefinitionFor } from './movement-registry.js';
import { movementReadinessChecklist } from './movement-readiness.js';

describe('movementReadinessChecklist', () => {
  it('marks rep-validating movements as recognition, count, and validation ready', () => {
    const checklist = movementReadinessChecklist(movementDefinitionFor('push_up'));

    expect(checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'recognition_ready', passed: true }),
        expect.objectContaining({ stage: 'count_ready', passed: true }),
        expect.objectContaining({ stage: 'validation_ready', passed: true }),
        expect.objectContaining({ stage: 'quality_ready', passed: false }),
      ]),
    );
  });

  it('keeps count-ready movements below validation-ready until criteria exist', () => {
    const checklist = movementReadinessChecklist(movementDefinitionFor('high_knees'));

    expect(checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'recognition_ready', passed: true }),
        expect.objectContaining({ stage: 'count_ready', passed: true }),
        expect.objectContaining({ stage: 'validation_ready', passed: false }),
      ]),
    );
  });

  it('keeps planned movement profiles inactive', () => {
    const checklist = movementReadinessChecklist(movementDefinitionFor('crunch'));

    expect(checklist.every((item) => item.passed === false)).toBe(true);
  });
});
