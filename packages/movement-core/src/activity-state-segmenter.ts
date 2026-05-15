import type { BodyState } from './body-state.js';
import type { MovementWindowSnapshot, ValidMovementWindowSample } from './movement-window.js';

export type ActivityStateKind =
  | 'idle'
  | 'setup'
  | 'moving'
  | 'resting'
  | 'tracking_lost'
  | 'unknown';

export interface ActivityStateSegmenterOptions {
  readonly minConfidence?: number;
  readonly minCoverage?: number;
  readonly movementVelocityThreshold?: number;
  readonly setupVelocityThreshold?: number;
  readonly restAfterMs?: number;
  readonly idleAfterMs?: number;
  readonly minWindowMs?: number;
}

export interface ActivityStateSnapshot {
  readonly state: ActivityStateKind;
  readonly confidence: number;
  readonly motionMagnitude: number;
  readonly lastMovementAtMs?: number;
  readonly evidence: readonly string[];
}

const defaultOptions = {
  minConfidence: 0.35,
  minCoverage: 0.35,
  movementVelocityThreshold: 0.75,
  setupVelocityThreshold: 0.14,
  restAfterMs: 1200,
  idleAfterMs: 6500,
  minWindowMs: 120,
} satisfies Required<ActivityStateSegmenterOptions>;

export class ActivityStateSegmenter {
  private lastMovementAtMs?: number;

  public constructor(private readonly options: ActivityStateSegmenterOptions = {}) {}

  public process(window: MovementWindowSnapshot): ActivityStateSnapshot {
    const options = { ...defaultOptions, ...this.options };
    const latest = window.latest;
    const latestValid = window.latestValid;
    const previousValid = window.previousValid;

    if (!latest || !latestValid) {
      return this.snapshot('tracking_lost', 0, 0, ['no_body_state']);
    }

    if (!latest.bodyState) {
      return this.snapshot('tracking_lost', 0, 0, ['latest_sample_missing']);
    }

    const quality = bodyTrackingQuality(latestValid.bodyState);

    if (
      quality < options.minConfidence ||
      latestValid.bodyState.coverage.fullBody < options.minCoverage ||
      window.missingSampleRatio > 0.5
    ) {
      return this.snapshot('tracking_lost', quality, 0, ['low_tracking_quality']);
    }

    if (!previousValid || window.durationMs < options.minWindowMs) {
      return this.snapshot('setup', quality, 0, ['warming_window']);
    }

    const motionMagnitude = bodyMotionMagnitude(previousValid, latestValid);
    const timestampMs = latestValid.timestampMs;

    if (motionMagnitude >= options.movementVelocityThreshold) {
      this.lastMovementAtMs = timestampMs;
      return this.snapshot('moving', quality, motionMagnitude, ['body_motion_threshold']);
    }

    const timeSinceMovement =
      this.lastMovementAtMs === undefined ? undefined : timestampMs - this.lastMovementAtMs;

    if (timeSinceMovement !== undefined && timeSinceMovement < options.restAfterMs) {
      return this.snapshot('moving', quality, motionMagnitude, ['movement_decay_window']);
    }

    if (timeSinceMovement !== undefined && timeSinceMovement < options.idleAfterMs) {
      return this.snapshot('resting', quality, motionMagnitude, ['recent_movement']);
    }

    if (motionMagnitude >= options.setupVelocityThreshold) {
      return this.snapshot('setup', quality, motionMagnitude, ['low_amplitude_motion']);
    }

    if (window.averageConfidence >= options.minConfidence) {
      return this.snapshot('idle', quality, motionMagnitude, ['stable_body']);
    }

    return this.snapshot('unknown', quality, motionMagnitude, ['insufficient_evidence']);
  }

  public reset(): void {
    this.lastMovementAtMs = undefined;
  }

  private snapshot(
    state: ActivityStateKind,
    confidence: number,
    motionMagnitude: number,
    evidence: readonly string[],
  ): ActivityStateSnapshot {
    return {
      state,
      confidence,
      motionMagnitude,
      lastMovementAtMs: this.lastMovementAtMs,
      evidence,
    };
  }
}

function bodyTrackingQuality(bodyState: BodyState): number {
  return average([
    bodyState.confidence,
    bodyState.coverage.fullBody,
    bodyState.orientation.confidence,
  ]);
}

function bodyMotionMagnitude(
  previous: ValidMovementWindowSample,
  latest: ValidMovementWindowSample,
): number {
  const elapsedSeconds = (latest.timestampMs - previous.timestampMs) / 1000;

  if (elapsedSeconds <= 0) {
    return 0;
  }

  const centerMotion =
    distance(previous.bodyState.geometry, latest.bodyState.geometry) / previous.bodyState.scale;
  const jointMotion = average([
    delta(previous.bodyState.jointAngles.leftElbow, latest.bodyState.jointAngles.leftElbow) / 180,
    delta(previous.bodyState.jointAngles.rightElbow, latest.bodyState.jointAngles.rightElbow) / 180,
    delta(previous.bodyState.jointAngles.leftKnee, latest.bodyState.jointAngles.leftKnee) / 180,
    delta(previous.bodyState.jointAngles.rightKnee, latest.bodyState.jointAngles.rightKnee) / 180,
    delta(
      previous.bodyState.geometry.torsoInclinationDegrees,
      latest.bodyState.geometry.torsoInclinationDegrees,
    ) / 90,
  ]);

  return (centerMotion + jointMotion) / elapsedSeconds;
}

function delta(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) {
    return 0;
  }

  return Math.abs(b - a);
}

function distance(
  a: { readonly centerOfMassX: number; readonly centerOfMassY: number },
  b: { readonly centerOfMassX: number; readonly centerOfMassY: number },
): number {
  return Math.hypot(b.centerOfMassX - a.centerOfMassX, b.centerOfMassY - a.centerOfMassY);
}

function average(values: readonly number[]): number {
  const finiteValues = values.filter(Number.isFinite);

  if (finiteValues.length === 0) {
    return 0;
  }

  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}
