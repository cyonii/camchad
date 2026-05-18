import { describe, expect, it } from 'vitest';

import {
  deriveCameraFrameFeedback,
  impulseForRep,
  type CameraFrameFeedbackInput,
} from './camera-frame-feedback.js';

import type { MovementInterpreterState, MovementRecognition } from '@camchad/movement-core';

type MovementStateOverrides = Omit<Partial<MovementInterpreterState>, 'recognition'> & {
  readonly recognition?: Partial<MovementRecognition>;
};

describe('deriveCameraFrameFeedback', () => {
  it('stays neutral while the camera preview is inactive', () => {
    expect(deriveCameraFrameFeedback(input({ isPreviewActive: false, isTracking: false }))).toEqual(
      expect.objectContaining({
        tone: 'standby',
        label: 'Standby',
      }),
    );
  });

  it('uses a restrained acquisition state before any body has been seen', () => {
    expect(
      deriveCameraFrameFeedback(
        input({
          detectorState: state({
            recognition: { status: 'tracking_lost', confidence: 0 },
            phase: 'tracking_lost',
          }),
          sessionTelemetry: {
            mode: 'observing',
            recognitionConfidence: 0,
            activityState: 'tracking_lost',
            activityConfidence: 0,
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        tone: 'acquiring',
        label: 'Awaiting body signal',
      }),
    );
  });

  it('locks the frame when recognition and activity confidence are stable', () => {
    expect(
      deriveCameraFrameFeedback(
        input({
          detectorState: state({
            recognition: { status: 'active', confidence: 0.84 },
            metrics: { poseConfidence: 0.78 },
          }),
          sessionTelemetry: {
            mode: 'moving',
            movementType: 'push_up',
            recognitionConfidence: 0.84,
            activityState: 'moving',
            activityConfidence: 0.79,
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        tone: 'locked',
        label: 'Signal stable',
      }),
    );
  });

  it('uses positioning guidance as a warning state before stable lock', () => {
    expect(
      deriveCameraFrameFeedback(
        input({
          detectorState: state({ recognition: { status: 'active', confidence: 0.82 } }),
          sessionTelemetry: {
            mode: 'moving',
            movementType: 'push_up',
            recognitionConfidence: 0.82,
            activityState: 'moving',
            activityConfidence: 0.74,
            guidanceEvents: [
              {
                code: 'full_body_not_visible',
                severity: 'warning',
                title: 'Full body not visible',
                message: 'Step back.',
                confidence: 0.7,
              },
            ],
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        tone: 'warning',
        label: 'Full body not visible',
      }),
    );
  });

  it('lets rep impulses temporarily override the persistent state', () => {
    expect(deriveCameraFrameFeedback(input({ impulse: 'rep_valid' }))).toEqual(
      expect.objectContaining({
        tone: 'success',
        impulse: 'rep_valid',
        label: 'Rep confirmed',
      }),
    );
  });

  it('classifies partial rep events from range warnings', () => {
    expect(
      impulseForRep({
        repNumber: 2,
        timestampMs: 1600,
        qualityScore: 48,
        rangeScore: 0.42,
        alignmentScore: 0.82,
        rhythmScore: 0.6,
        confidenceScore: 0.74,
        trackingQualityScore: 0.91,
        warnings: [
          {
            code: 'range_of_motion',
            message: 'Movement pattern was detected, but the range was incomplete.',
          },
        ],
      }),
    ).toBe('rep_partial');
  });
});

function input(overrides: Partial<CameraFrameFeedbackInput> = {}): CameraFrameFeedbackInput {
  return {
    isPreviewActive: true,
    isStarting: false,
    isTracking: true,
    detectorState: state(),
    sessionTelemetry: {
      mode: 'observing',
      recognitionConfidence: 0.2,
      activityState: 'setup',
      activityConfidence: 0.3,
    },
    ...overrides,
  };
}

function state(overrides: MovementStateOverrides = {}): MovementInterpreterState {
  const { recognition, ...stateOverrides } = overrides;

  return {
    movementType: 'push_up',
    phase: 'setup_needed',
    reps: 0,
    validReps: 0,
    partialReps: 0,
    warnings: [],
    metrics: {},
    ...stateOverrides,
    recognition: {
      confidence: 0.2,
      status: 'candidate',
      evidence: [],
      movementType: 'push_up',
      ...recognition,
    },
  };
}
