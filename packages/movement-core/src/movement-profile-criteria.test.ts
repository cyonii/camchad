import { describe, expect, it } from 'vitest';

import { movementDefinitionFor } from './movement-registry.js';
import {
  createMovementProfileWindow,
  evaluateMovementProfileFrame,
} from './movement-profile-evaluation-context.js';
import { evaluateMovementRecognitionCriteria } from './movement-profile-criteria.js';
import { makePushUpFrame, makeSquatFrame } from './test-fixtures.js';

describe('evaluateMovementRecognitionCriteria', () => {
  it('passes push-up declarative criteria for a floor-oriented push-up frame', () => {
    const context = contextFor(makePushUpFrame({ timestampMs: 0, elbowAngle: 144 }));
    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor('push_up'),
      context,
      cameraAngle: 'side',
    });

    expect(evaluation).toMatchObject({
      passed: true,
      evidence: expect.arrayContaining([
        'torso_visible',
        'arms_visible',
        'floor_orientation_match',
        'camera_angle_supported',
      ]),
    });
    expect(evaluation.confidence).toBeGreaterThan(0.58);
  });

  it('passes squat declarative criteria for a standing squat frame', () => {
    const context = contextFor(makeSquatFrame({ timestampMs: 0, kneeAngle: 132 }));
    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor('squat'),
      context,
      cameraAngle: 'side',
    });

    expect(evaluation).toMatchObject({
      passed: true,
      evidence: expect.arrayContaining([
        'torso_visible',
        'legs_visible',
        'standing_orientation_match',
        'camera_angle_supported',
      ]),
    });
    expect(evaluation.confidence).toBeGreaterThan(0.58);
  });

  it('surfaces orientation mismatch instead of passing the wrong profile', () => {
    const context = contextFor(makeSquatFrame({ timestampMs: 0, kneeAngle: 132 }));
    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor('push_up'),
      context,
      cameraAngle: 'side',
    });

    expect(evaluation.passed).toBe(false);
    expect(
      evaluation.evaluations.find((candidate) => candidate.key === 'body_orientation'),
    ).toMatchObject({
      passed: false,
      evidence: 'body_orientation_mismatch',
    });
  });
});

function contextFor(frame: Parameters<typeof evaluateMovementProfileFrame>[0]['frame']) {
  const context = evaluateMovementProfileFrame({
    frame,
    window: createMovementProfileWindow(),
  });

  if (!context) {
    throw new Error('Expected test fixture to produce a movement profile context.');
  }

  return context;
}
