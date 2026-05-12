import type { MovementInterpreter } from './movement-interpreter.js';
import {
  defaultPushUpConfig,
  PushUpMovementInterpreter,
  type PushUpMovementInterpreterConfig,
} from './push-up-interpreter.js';

export interface MovementDefinition {
  readonly type: 'push_up';
  readonly label: string;
  readonly defaultCameraAngle: 'side' | 'front_diagonal';
  readonly createInterpreter: (
    config?: Partial<PushUpMovementInterpreterConfig>,
  ) => MovementInterpreter;
}

export const movementRegistry: readonly MovementDefinition[] = [
  {
    type: 'push_up',
    label: 'Push-ups',
    defaultCameraAngle: 'side',
    createInterpreter: (config) =>
      new PushUpMovementInterpreter({ ...defaultPushUpConfig, ...config }),
  },
];
