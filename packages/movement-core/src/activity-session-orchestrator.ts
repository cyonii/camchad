import type {
  CameraAngle,
  MovementInterpreterState,
  MovementType,
} from './movement-interpreter.js';

export type ActivitySessionMode = 'idle' | 'observing' | 'moving' | 'resting';

export interface CameraAngleAdvice {
  readonly movementType: MovementType;
  readonly severity: 'info' | 'warning';
  readonly title: string;
  readonly message: string;
  readonly recommendedAngle: CameraAngle;
}

export interface ActivitySessionTelemetry {
  readonly mode: ActivitySessionMode;
  readonly movementType?: MovementType;
  readonly recognitionConfidence: number;
  readonly activeSetStartedAtMs?: number;
  readonly lastMovementAtMs?: number;
  readonly cameraAdvice?: CameraAngleAdvice;
}

export interface ActivitySessionOrchestratorOptions {
  readonly cameraAngle: CameraAngle;
  readonly movementStartConfidence?: number;
  readonly restAfterMs?: number;
  readonly idleAfterMs?: number;
}

const defaultMovementStartConfidence = 0.6;
const defaultRestAfterMs = 1400;
const defaultIdleAfterMs = 8000;

export class ActivitySessionOrchestrator {
  private activeSetStartedAtMs?: number;
  private lastMovementAtMs?: number;

  public constructor(private options: ActivitySessionOrchestratorOptions) {}

  public updateOptions(options: ActivitySessionOrchestratorOptions): void {
    this.options = options;
  }

  public process(
    state: MovementInterpreterState,
    timestampMs = Date.now(),
  ): ActivitySessionTelemetry {
    const recognition = state.recognition;
    const confidence = recognition.confidence;
    const movementType = recognition.movementType;
    const isRecognizedMovement =
      movementType !== undefined &&
      recognition.status !== 'tracking_lost' &&
      confidence >= (this.options.movementStartConfidence ?? defaultMovementStartConfidence);

    if (isRecognizedMovement) {
      this.activeSetStartedAtMs ??= timestampMs;
      this.lastMovementAtMs = timestampMs;

      return {
        mode: 'moving',
        movementType,
        recognitionConfidence: confidence,
        activeSetStartedAtMs: this.activeSetStartedAtMs,
        lastMovementAtMs: this.lastMovementAtMs,
        cameraAdvice: cameraAdviceFor(movementType, this.options.cameraAngle),
      };
    }

    const timeSinceMovement =
      this.lastMovementAtMs === undefined ? undefined : timestampMs - this.lastMovementAtMs;

    if (timeSinceMovement !== undefined) {
      if (timeSinceMovement >= (this.options.idleAfterMs ?? defaultIdleAfterMs)) {
        this.activeSetStartedAtMs = undefined;
        this.lastMovementAtMs = undefined;

        return {
          mode: 'idle',
          recognitionConfidence: confidence,
        };
      }

      if (timeSinceMovement >= (this.options.restAfterMs ?? defaultRestAfterMs)) {
        return {
          mode: 'resting',
          movementType,
          recognitionConfidence: confidence,
          activeSetStartedAtMs: this.activeSetStartedAtMs,
          lastMovementAtMs: this.lastMovementAtMs,
          cameraAdvice: movementType
            ? cameraAdviceFor(movementType, this.options.cameraAngle)
            : undefined,
        };
      }
    }

    return {
      mode: 'observing',
      movementType,
      recognitionConfidence: confidence,
      activeSetStartedAtMs: this.activeSetStartedAtMs,
      lastMovementAtMs: this.lastMovementAtMs,
      cameraAdvice: movementType
        ? cameraAdviceFor(movementType, this.options.cameraAngle)
        : undefined,
    };
  }

  public reset(): void {
    this.activeSetStartedAtMs = undefined;
    this.lastMovementAtMs = undefined;
  }
}

export function cameraAdviceFor(
  movementType: MovementType,
  cameraAngle: CameraAngle,
): CameraAngleAdvice {
  if (movementType === 'push_up' && cameraAngle !== 'side') {
    return {
      movementType,
      severity: 'warning',
      title: 'Prefer side view',
      message: 'Push-up depth and body-line checks are more reliable from a clean side angle.',
      recommendedAngle: 'side',
    };
  }

  return {
    movementType,
    severity: 'info',
    title: 'Camera angle usable',
    message: 'Keep shoulders, hips, wrists, and ankles visible for stable push-up analysis.',
    recommendedAngle: 'side',
  };
}
