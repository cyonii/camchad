import { describe, expect, it } from 'vitest';

import { movementDefinitionFor } from './movement-registry.js';
import {
  createMovementProfileWindow,
  evaluateMovementProfileFrame,
} from './movement-profile-evaluation-context.js';
import { evaluateMovementRecognitionCriteria } from './movement-profile-criteria.js';
import {
  makeHighKneesSequence,
  makePlankFrame,
  makePushUpFrame,
  makeSquatFrame,
  type PoseSequence,
} from './test-fixtures.js';

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

  it('uses high-knees-specific geometry instead of broad standing criteria', () => {
    const context = contextForSequence(makeHighKneesSequence(0));
    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor('high_knees'),
      context,
      cameraAngle: 'front',
    });

    expect(evaluation).toMatchObject({
      passed: true,
      evidence: expect.arrayContaining(['alternating_knee_lift', 'vertical_cadence']),
    });
    expect(
      evaluation.evaluations.find((candidate) => candidate.key === 'alternating_knee_lift'),
    ).toMatchObject({
      passed: true,
    });
  });

  it('rejects high-knees criteria when a standing frame lacks knee lift evidence', () => {
    const context = contextFor(makeSquatFrame({ timestampMs: 0, kneeAngle: 170 }));
    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor('high_knees'),
      context,
      cameraAngle: 'front',
    });

    expect(evaluation.passed).toBe(false);
    expect(
      evaluation.evaluations.find((candidate) => candidate.key === 'alternating_knee_lift'),
    ).toMatchObject({
      passed: false,
    });
  });

  it('uses plank-specific body-line and hold-stability criteria', () => {
    const context = contextForSequence([makePlankFrame(0), makePlankFrame(700)]);
    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor('plank'),
      context,
      cameraAngle: 'side',
    });

    expect(evaluation).toMatchObject({
      passed: true,
      evidence: expect.arrayContaining(['horizontal_body_line', 'static_hold_stability']),
    });
    expect(
      evaluation.evaluations.find((candidate) => candidate.key === 'horizontal_body_line'),
    ).toMatchObject({
      passed: true,
    });
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

  it('fails loudly when a declarative criterion has no evaluator', () => {
    const context = contextFor(makeSquatFrame({ timestampMs: 0, kneeAngle: 132 }));
    const definition = movementDefinitionFor('squat');

    expect(() =>
      evaluateMovementRecognitionCriteria({
        definition: {
          ...definition,
          profile: {
            ...definition.profile,
            recognitionCriteria: [
              ...definition.profile.recognitionCriteria,
              {
                key: 'unsupported_test_criterion',
                label: 'Unsupported test criterion',
                source: 'declarative',
              },
            ],
          },
        },
        context,
        cameraAngle: 'side',
      }),
    ).toThrow(/Unsupported movement recognition criterion/);
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

function contextForSequence(sequence: PoseSequence) {
  const window = createMovementProfileWindow();
  let context: ReturnType<typeof evaluateMovementProfileFrame> | undefined;

  for (const frame of sequence) {
    context = evaluateMovementProfileFrame({
      frame,
      window,
    });
  }

  if (!context) {
    throw new Error('Expected test fixture sequence to produce a movement profile context.');
  }

  return context;
}
