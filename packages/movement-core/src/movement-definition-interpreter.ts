import type { MovementInterpreter, MovementType } from './movement-interpreter.js';
import type { MovementDefinition } from './movement-registry.js';
import {
  createProfileMovementInterpreter,
  isProfileMovementType,
} from './profile-movement-interpreters.js';
import {
  createRepValidatingMovementInterpreter,
  type RepValidatingMovementType,
} from './rep-validating-movement-interpreter.js';

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

  if (isProfileMovementType(definition.type)) {
    return createProfileMovementInterpreter(definition.type);
  }

  return createRepValidatingInterpreter(definition.type, options);
}

function createRepValidatingInterpreter(
  movementType: MovementType,
  options: MovementInterpreterFactoryOptions,
): MovementInterpreter {
  if (!isRepValidatingMovementType(movementType)) {
    throw new Error(`No rep-validating movement module registered for ${movementType}.`);
  }

  return createRepValidatingMovementInterpreter(movementType, options);
}

function isRepValidatingMovementType(
  movementType: MovementType,
): movementType is RepValidatingMovementType {
  return movementType === 'push_up' || movementType === 'squat';
}
