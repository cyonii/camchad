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

  it('keeps movement definition schema internally consistent', () => {
    const types = new Set<string>();

    for (const movement of movementRegistry) {
      expect(types.has(movement.type)).toBe(false);
      types.add(movement.type);

      expect(movement.label.trim()).toBeTruthy();
      expect(movement.pluralLabel.trim()).toBeTruthy();
      expect(movement.repLabel.trim()).toBeTruthy();
      expect(movement.repPluralLabel.trim()).toBeTruthy();
      expect(movement.profile.maturity).toBe(movement.maturity);
      expect(movement.supportedCameraAngles).toContain(movement.defaultCameraAngle);
      expect(movement.supportedCameraAngles).toContain(movement.cameraGuidance.recommendedAngle);
      expect(movement.cameraGuidance.usableTitle.trim()).toBeTruthy();
      expect(movement.cameraGuidance.usableMessage.trim()).toBeTruthy();
      expect(movement.cameraGuidance.warningTitle.trim()).toBeTruthy();
      expect(movement.cameraGuidance.warningMessage.trim()).toBeTruthy();
      if (movement.maturity !== 'rep_validating') {
        expect(movement.profile.telemetrySignals).toEqual(
          expect.arrayContaining([...movement.analysisSignals]),
        );
      }
      if (movement.maturity !== 'rep_validating') {
        expect(movement.profile.telemetryExtractors.map((extractor) => extractor.key)).toEqual(
          expect.arrayContaining(
            movement.profile.telemetrySignals.map((signal) =>
              signal
                .toLowerCase()
                .replaceAll(/[^a-z0-9]+/g, '_')
                .replaceAll(/^_|_$/g, ''),
            ),
          ),
        );
      }
    }
  });

  it('requires executable criteria only for implemented movement profiles', () => {
    for (const movement of movementRegistry) {
      const recognitionSources = movement.profile.recognitionCriteria.map(
        (criterion) => criterion.source,
      );

      if (movement.maturity === 'planned') {
        expect(recognitionSources.every((source) => source === 'planned')).toBe(true);
      } else {
        expect(recognitionSources).toContain('declarative');
        expect(recognitionSources).not.toContain('planned');
      }
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
        expect.objectContaining({ key: 'push_up_phase_machine', source: 'validation_profile' }),
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
