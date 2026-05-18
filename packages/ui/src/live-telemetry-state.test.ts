import { describe, expect, it } from 'vitest';

import type { ActivitySessionTelemetry, MovementInterpreterState } from '@camchad/movement-core';

import { liveTelemetryStateFor } from './live-telemetry-state.js';

describe('liveTelemetryStateFor', () => {
  it('surfaces tracking loss before movement phase language', () => {
    expect(
      liveTelemetryStateFor(
        state({ phase: 'tracking_lost', stateKind: 'tracking_lost' }),
        telemetry({ mode: 'moving' }),
      ),
    ).toMatchObject({
      label: 'Tracking interrupted',
    });
  });

  it('labels active cyclic phases as tracking movement', () => {
    expect(
      liveTelemetryStateFor(
        state({ phase: 'descending', stateKind: 'active_rep' }),
        telemetry({ mode: 'moving' }),
      ),
    ).toEqual({
      label: 'Tracking movement',
      detail: 'descending',
    });
  });

  it('labels a completed validating-profile rep as validated', () => {
    expect(
      liveTelemetryStateFor(
        state({
          phase: 'top',
          stateKind: 'setup',
          lastRep: {
            repNumber: 3,
            timestampMs: 3000,
            qualityScore: 94,
            rangeScore: 1,
            alignmentScore: 0.9,
            rhythmScore: 0.86,
            confidenceScore: 0.94,
            trackingQualityScore: 0.98,
            warnings: [],
          },
        }),
        telemetry({ mode: 'moving' }),
      ),
    ).toEqual({
      label: 'Validated rep',
      detail: 'Rep 3',
    });
  });

  it('labels a completed count-ready profile rep without implying validation', () => {
    expect(
      liveTelemetryStateFor(
        state({
          movementType: 'high_knees',
          phase: 'top',
          stateKind: 'setup',
          lastRep: {
            repNumber: 2,
            timestampMs: 2400,
            qualityScore: 78,
            rangeScore: 0.84,
            alignmentScore: 0.78,
            rhythmScore: 0.82,
            confidenceScore: 0.75,
            trackingQualityScore: 0.9,
            warnings: [],
          },
        }),
        telemetry({ mode: 'moving' }),
      ),
    ).toEqual({
      label: 'Rep counted',
      detail: 'Rep 2',
    });
  });

  it('uses state kind for failed rep copy', () => {
    expect(
      liveTelemetryStateFor(
        state({
          phase: 'invalid_form',
          stateKind: 'failed_rep',
          warnings: [{ code: 'body_alignment', message: 'Keep your body line stable.' }],
        }),
        telemetry({ mode: 'moving' }),
      ),
    ).toEqual({
      label: 'Form issue',
      detail: 'Keep your body line stable.',
    });
  });

  it('keeps idle telemetry in observing mode', () => {
    expect(liveTelemetryStateFor(state(), telemetry({ mode: 'idle' }))).toEqual({
      label: 'Observing',
      detail: 'Standby',
    });
  });
});

function state(overrides: Partial<MovementInterpreterState> = {}): MovementInterpreterState {
  return {
    movementType: 'push_up',
    recognition: {
      movementType: undefined,
      confidence: 0,
      status: 'candidate',
      evidence: [],
    },
    phase: 'setup_needed',
    stateKind: 'setup',
    reps: 0,
    validReps: 0,
    partialReps: 0,
    warnings: [],
    metrics: {},
    ...overrides,
  };
}

function telemetry(overrides: Partial<ActivitySessionTelemetry> = {}): ActivitySessionTelemetry {
  return {
    mode: 'observing',
    recognitionConfidence: 0,
    ...overrides,
  };
}
