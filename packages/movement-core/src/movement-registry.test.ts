import { describe, expect, it } from 'vitest';

import { movementDefinitionFor, movementRegistry } from './movement-registry.js';

describe('movementRegistry profiles', () => {
  it('defines structured profile metadata for every movement', () => {
    expect(movementRegistry.length).toBeGreaterThan(0);

    for (const movement of movementRegistry) {
      expect(movement.profile.requiredRegions.length).toBeGreaterThan(0);
      expect(movement.profile.primaryJoints.length).toBeGreaterThan(0);
      expect(movement.profile.phaseModel.length).toBeGreaterThan(0);
      expect(movement.profile.recognitionCriteria.length).toBeGreaterThan(0);
      expect(movement.profile.validationCriteria.length).toBeGreaterThan(0);
      expect(movement.profile.telemetrySignals.length).toBeGreaterThan(0);
      expect(movement.profile.telemetryExtractors.length).toBeGreaterThan(0);
      expect(movement.profile.failureCriteria.length).toBeGreaterThan(0);
    }
  });

  it('records maturity explicitly without embedding interpreter construction', () => {
    expect(movementDefinitionFor('push_up').profile).toMatchObject({
      maturity: 'rep_validating',
      rhythm: 'cyclic',
      cameraSensitivity: 'high',
    });
    expect(movementDefinitionFor('squat').profile).toMatchObject({
      maturity: 'rep_validating',
      rhythm: 'cyclic',
    });
    expect(movementDefinitionFor('sit_up').profile.maturity).toBe('recognizable');
    expect(movementDefinitionFor('crunch').profile.maturity).toBe('planned');
  });

  it('defines first-class telemetry extractors for rep-validating profiles', () => {
    expect(movementDefinitionFor('push_up').profile.telemetryExtractors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'primaryJointAngle', source: 'metric' }),
        expect.objectContaining({ key: 'rhythmScore', source: 'metric' }),
      ]),
    );
    expect(movementDefinitionFor('squat').profile.telemetryExtractors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'postureScore', source: 'metric' }),
        expect.objectContaining({ key: 'primaryJointRange', source: 'metric' }),
      ]),
    );
  });

  it('separates recognition criteria from rep-validation criteria', () => {
    expect(movementDefinitionFor('push_up').profile.recognitionCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'floor_orientation', source: 'declarative' }),
      ]),
    );
    expect(movementDefinitionFor('push_up').profile.validationCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'push_up_phase_machine', source: 'definition_module' }),
      ]),
    );
    expect(movementDefinitionFor('sit_up').profile.validationCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'rep_validating_pending', source: 'planned' }),
      ]),
    );
  });

  it('keeps planned profiles descriptive without pretending they are implemented', () => {
    const planned = movementRegistry.filter((movement) => movement.maturity === 'planned');

    expect(planned.length).toBeGreaterThan(0);
    expect(
      planned.every((movement) =>
        movement.profile.failureCriteria.includes('movement profile not implemented'),
      ),
    ).toBe(true);
    expect(
      planned.every((movement) =>
        movement.profile.telemetryExtractors.every((extractor) => extractor.source === 'planned'),
      ),
    ).toBe(true);
  });
});
