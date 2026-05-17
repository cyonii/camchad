import type { MovementInterpreter, MovementType } from './movement-interpreter.js';
import type { MovementDefinition } from './movement-registry.js';
import { defaultPushUpConfig, PushUpMovementInterpreter } from './push-up-interpreter.js';
import {
  createProfileMovementInterpreter,
  isProfileMovementType,
} from './profile-movement-interpreters.js';
import { defaultSquatConfig, SquatMovementInterpreter } from './squat-interpreter.js';

export interface MovementInterpreterFactoryOptions {
  readonly cameraAngle?: MovementDefinition['defaultCameraAngle'];
}

export function createMovementInterpreterForDefinition(
  definition: MovementDefinition,
  options: MovementInterpreterFactoryOptions = {},
): MovementInterpreter | undefined {
  if (definition.maturity === 'planned') {
    return undefined;
  }

  if (definition.maturity === 'recognizable') {
    if (!isProfileMovementType(definition.type)) {
      throw new Error(`No recognizable movement module registered for ${definition.type}.`);
    }

    return createProfileMovementInterpreter(definition.type);
  }

  return createRepValidatingInterpreter(definition.type, options);
}

function createRepValidatingInterpreter(
  movementType: MovementType,
  options: MovementInterpreterFactoryOptions,
): MovementInterpreter {
  switch (movementType) {
    case 'push_up':
      return new PushUpMovementInterpreter({
        ...defaultPushUpConfig,
        cameraAngle: options.cameraAngle ?? defaultPushUpConfig.cameraAngle,
      });
    case 'squat':
      return new SquatMovementInterpreter({
        ...defaultSquatConfig,
        cameraAngle: options.cameraAngle ?? defaultSquatConfig.cameraAngle,
      });
    default:
      throw new Error(`No rep-validating movement module registered for ${movementType}.`);
  }
}
