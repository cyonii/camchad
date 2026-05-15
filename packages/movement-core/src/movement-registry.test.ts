import { describe, expect, it } from 'vitest';

import { movementDefinitionFor, movementRegistry } from './movement-registry.js';

describe('movementRegistry profiles', () => {
  it('defines structured profile metadata for every movement', () => {
    expect(movementRegistry.length).toBeGreaterThan(0);

    for (const movement of movementRegistry) {
      expect(movement.profile.requiredRegions.length).toBeGreaterThan(0);
      expect(movement.profile.primaryJoints.length).toBeGreaterThan(0);
      expect(movement.profile.phaseModel.length).toBeGreaterThan(0);
      expect(movement.profile.telemetrySignals.length).toBeGreaterThan(0);
      expect(movement.profile.failureCriteria.length).toBeGreaterThan(0);
    }
  });

  it('marks validation-ready movements separately from recognition-only movement profiles', () => {
    expect(movementDefinitionFor('push_up').profile).toMatchObject({
      validationReadiness: 'rep_validation',
      rhythm: 'cyclic',
      cameraSensitivity: 'high',
    });
    expect(movementDefinitionFor('squat').profile).toMatchObject({
      validationReadiness: 'rep_validation',
      rhythm: 'cyclic',
    });
    expect(movementDefinitionFor('sit_up').profile.validationReadiness).toBe('recognition_only');
    expect(movementDefinitionFor('crunch').profile.validationReadiness).toBe('profile_pending');
  });

  it('keeps planned profiles descriptive without pretending they are implemented', () => {
    const planned = movementRegistry.filter((movement) => movement.supportLevel === 'planned');

    expect(planned.length).toBeGreaterThan(0);
    expect(
      planned.every((movement) =>
        movement.profile.failureCriteria.includes('movement profile not implemented'),
      ),
    ).toBe(true);
    expect(planned.every((movement) => movement.createInterpreter === undefined)).toBe(true);
  });
});
