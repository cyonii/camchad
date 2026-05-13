import type { CameraAngle, MovementInterpreter, MovementType } from './movement-interpreter.js';
import { defaultPushUpConfig, PushUpMovementInterpreter } from './push-up-interpreter.js';

export interface MovementDefinition {
  readonly type: MovementType;
  readonly label: string;
  readonly pluralLabel: string;
  readonly repLabel: string;
  readonly repPluralLabel: string;
  readonly defaultCameraAngle: CameraAngle;
  readonly cameraGuidance: MovementCameraGuidance;
  readonly telemetryMetrics: readonly MovementTelemetryMetricDefinition[];
  readonly createInterpreter: (options?: MovementInterpreterFactoryOptions) => MovementInterpreter;
}

export interface MovementInterpreterFactoryOptions {
  readonly cameraAngle?: CameraAngle;
}

export interface MovementCameraGuidance {
  readonly recommendedAngle: CameraAngle;
  readonly usableTitle: string;
  readonly usableMessage: string;
  readonly warningTitle: string;
  readonly warningMessage: string;
}

export interface CameraAngleAdvice {
  readonly movementType: MovementType;
  readonly severity: 'info' | 'warning';
  readonly title: string;
  readonly message: string;
  readonly recommendedAngle: CameraAngle;
}

export interface MovementTelemetryMetricDefinition {
  readonly key: string;
  readonly label: string;
  readonly unit: 'deg' | '%';
}

export const movementRegistry: readonly MovementDefinition[] = [
  {
    type: 'push_up',
    label: 'Push-up',
    pluralLabel: 'Push-ups',
    repLabel: 'push-up',
    repPluralLabel: 'push-ups',
    defaultCameraAngle: 'side',
    cameraGuidance: {
      recommendedAngle: 'side',
      usableTitle: 'Camera angle usable',
      usableMessage: 'Keep shoulders, hips, wrists, and ankles visible for stable analysis.',
      warningTitle: 'Prefer side view',
      warningMessage: 'Depth and body-line checks are more reliable from a clean side angle.',
    },
    telemetryMetrics: [
      { key: 'primaryJointAngle', label: 'Primary joint', unit: 'deg' },
      { key: 'rangeOfMotionScore', label: 'Range', unit: '%' },
      { key: 'alignmentScore', label: 'Alignment', unit: '%' },
      { key: 'movementConfidence', label: 'Signal', unit: '%' },
    ],
    createInterpreter: (options) =>
      new PushUpMovementInterpreter({
        ...defaultPushUpConfig,
        cameraAngle: options?.cameraAngle ?? defaultPushUpConfig.cameraAngle,
      }),
  },
];

export function movementDefinitionFor(type: MovementType): MovementDefinition {
  const definition = movementRegistry.find((movement) => movement.type === type);

  if (!definition) {
    throw new Error(`Unsupported movement type: ${type}`);
  }

  return definition;
}

export function cameraAdviceFor(
  movementType: MovementType,
  cameraAngle: CameraAngle,
): CameraAngleAdvice {
  const definition = movementDefinitionFor(movementType);
  const guidance = definition.cameraGuidance;
  const isRecommendedAngle = cameraAngle === guidance.recommendedAngle;

  return {
    movementType,
    severity: isRecommendedAngle ? 'info' : 'warning',
    title: isRecommendedAngle ? guidance.usableTitle : guidance.warningTitle,
    message: isRecommendedAngle ? guidance.usableMessage : guidance.warningMessage,
    recommendedAngle: guidance.recommendedAngle,
  };
}
