import { describe, expect, it } from 'vitest';

import {
  toLandmarkMap,
  type LandmarkName,
  type PoseFrame,
  type PoseLandmark,
} from '@camchad/pose-core';

import { movementDefinitionFor } from './movement-registry.js';
import {
  createMovementProfileWindow,
  evaluateMovementProfileFrame,
} from './movement-profile-evaluation-context.js';
import { evaluateMovementRecognitionCriteria } from './movement-profile-criteria.js';
import {
  makeHighKneesSequence,
  makeLungeLikeSequence,
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

  it.each([
    {
      movementType: 'sit_up' as const,
      frame: makePushUpFrame({ timestampMs: 0, elbowAngle: 150 }),
      cameraAngle: 'side' as const,
      evidence: ['torso_curl_trajectory', 'hip_anchor_stability'],
    },
    {
      movementType: 'lunge' as const,
      frame: makeLungeLikeSequence(0).at(-1),
      cameraAngle: 'front' as const,
      evidence: ['split_stance', 'front_knee_flexion', 'hip_drop'],
    },
    {
      movementType: 'jumping_jack' as const,
      frame: jumpingJackFrame(0),
      cameraAngle: 'front' as const,
      evidence: ['arm_leg_abduction_rhythm', 'wrist_and_ankle_span_oscillation'],
    },
    {
      movementType: 'mountain_climber' as const,
      frame: mountainClimberFrame(0),
      cameraAngle: 'side' as const,
      evidence: ['plank_base', 'alternating_knee_drive'],
    },
    {
      movementType: 'pull_up' as const,
      frame: pullUpFrame(0),
      cameraAngle: 'side' as const,
      evidence: ['vertical_hanging_posture', 'elbow_flexion', 'shoulder_elevation_change'],
    },
    {
      movementType: 'lateral_raise' as const,
      frame: lateralRaiseFrame(0),
      cameraAngle: 'front' as const,
      evidence: ['shoulder_abduction', 'arm_elevation_symmetry'],
    },
  ])('passes explicit $movementType criteria for a matching fixture', (caseInput) => {
    if (!caseInput.frame) {
      throw new Error('Expected test case to provide a frame.');
    }

    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor(caseInput.movementType),
      context: contextFor(caseInput.frame),
      cameraAngle: caseInput.cameraAngle,
    });

    expect(evaluation).toMatchObject({
      passed: true,
      evidence: expect.arrayContaining(caseInput.evidence),
    });
  });

  it('rejects explicit lunge criteria when stance evidence is absent', () => {
    const evaluation = evaluateMovementRecognitionCriteria({
      definition: movementDefinitionFor('lunge'),
      context: contextFor(makeSquatFrame({ timestampMs: 0, kneeAngle: 170 })),
      cameraAngle: 'front',
    });

    expect(evaluation.passed).toBe(false);
    expect(
      evaluation.evaluations.find((candidate) => candidate.key === 'split_stance'),
    ).toMatchObject({
      passed: false,
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

function jumpingJackFrame(timestampMs: number): PoseFrame {
  return mapLandmarks(makeSquatFrame({ timestampMs, kneeAngle: 170 }), (landmark) => {
    switch (landmark.name) {
      case 'left_wrist':
        return { ...landmark, x: 0.18, y: 0.32 };
      case 'right_wrist':
        return { ...landmark, x: 0.82, y: 0.32 };
      case 'left_ankle':
        return { ...landmark, x: 0.22, y: 0.88 };
      case 'right_ankle':
        return { ...landmark, x: 0.78, y: 0.88 };
      default:
        return landmark;
    }
  });
}

function mountainClimberFrame(timestampMs: number): PoseFrame {
  return mapLandmarks(makePlankFrame(timestampMs), (landmark) => {
    switch (landmark.name) {
      case 'left_knee':
        return { ...landmark, x: 0.47, y: 0.24 };
      default:
        return landmark;
    }
  });
}

function pullUpFrame(timestampMs: number): PoseFrame {
  return addLandmarks(
    mapLandmarks(makeSquatFrame({ timestampMs, kneeAngle: 170 }), (landmark) => {
      switch (landmark.name) {
        case 'left_wrist':
          return { ...landmark, x: 0.42, y: 0.04 };
        case 'right_wrist':
          return { ...landmark, x: 0.58, y: 0.04 };
        case 'left_elbow':
          return { ...landmark, x: 0.42, y: 0.16 };
        case 'right_elbow':
          return { ...landmark, x: 0.58, y: 0.16 };
        default:
          return landmark;
      }
    }),
    [
      ['left_pinky', 0.4, 0.04],
      ['left_index', 0.42, 0.03],
      ['left_thumb', 0.44, 0.04],
      ['right_pinky', 0.56, 0.04],
      ['right_index', 0.58, 0.03],
      ['right_thumb', 0.6, 0.04],
    ],
  );
}

function lateralRaiseFrame(timestampMs: number): PoseFrame {
  return addLandmarks(
    mapLandmarks(makeSquatFrame({ timestampMs, kneeAngle: 170 }), (landmark) => {
      switch (landmark.name) {
        case 'left_wrist':
          return { ...landmark, x: 0.16, y: 0.24 };
        case 'right_wrist':
          return { ...landmark, x: 0.84, y: 0.24 };
        default:
          return landmark;
      }
    }),
    [
      ['left_pinky', 0.14, 0.24],
      ['left_index', 0.16, 0.23],
      ['left_thumb', 0.18, 0.24],
      ['right_pinky', 0.82, 0.24],
      ['right_index', 0.84, 0.23],
      ['right_thumb', 0.86, 0.24],
    ],
  );
}

function mapLandmarks(
  frame: PoseFrame,
  mapper: (landmark: PoseLandmark) => PoseLandmark,
): PoseFrame {
  return {
    ...frame,
    landmarks: toLandmarkMap([...frame.landmarks.values()].map(mapper)),
  };
}

function addLandmarks(
  frame: PoseFrame,
  landmarks: readonly (readonly [name: LandmarkName, x: number, y: number])[],
): PoseFrame {
  return {
    ...frame,
    landmarks: toLandmarkMap([
      ...frame.landmarks.values(),
      ...landmarks.map(([name, x, y]) => ({
        name,
        x,
        y,
        z: 0,
        visibility: 0.95,
        presence: 0.95,
      })),
    ]),
  };
}
