import type { CameraAngle, MovementInterpreter, MovementType } from './movement-interpreter.js';
import {
  defaultPushUpConfig,
  PushUpMovementInterpreter,
  type PushUpMovementInterpreterConfig,
} from './push-up-interpreter.js';

export interface MovementDefinition {
  readonly type: MovementType;
  readonly label: string;
  readonly pluralLabel: string;
  readonly repLabel: string;
  readonly repPluralLabel: string;
  readonly defaultCameraAngle: CameraAngle;
  readonly telemetryMetrics: readonly MovementTelemetryMetricDefinition[];
  readonly createInterpreter: (
    config?: Partial<PushUpMovementInterpreterConfig>,
  ) => MovementInterpreter;
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
    telemetryMetrics: [
      { key: 'primaryJointAngle', label: 'Primary joint', unit: 'deg' },
      { key: 'rangeOfMotionScore', label: 'Range', unit: '%' },
      { key: 'alignmentScore', label: 'Alignment', unit: '%' },
      { key: 'movementConfidence', label: 'Signal', unit: '%' },
    ],
    createInterpreter: (config) =>
      new PushUpMovementInterpreter({ ...defaultPushUpConfig, ...config }),
  },
];

export function movementDefinitionFor(type: MovementType): MovementDefinition {
  const definition = movementRegistry.find((movement) => movement.type === type);

  if (!definition) {
    throw new Error(`Unsupported movement type: ${type}`);
  }

  return definition;
}
