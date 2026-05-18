import type { CameraAngle, MovementType } from './movement-interpreter.js';
import { movementCatalog } from './movement-catalog.js';
import type { MovementDefinition, CameraAngleAdvice } from './movement-definition-types.js';
import { movementProfiles } from './movement-profile-definitions.js';

export type {
  CameraAngleAdvice,
  MovementBodyOrientation,
  MovementCameraGuidance,
  MovementCameraSensitivity,
  MovementCategory,
  MovementDefinition,
  MovementMaturityLevel,
  MovementProfileCriterion,
  MovementProfileCriterionSource,
  MovementProfileMetadata,
  MovementRegion,
  MovementRhythmType,
  MovementSetupHint,
  MovementTelemetryExtractorDefinition,
  MovementTelemetryExtractorSource,
  MovementTelemetryMetricDefinition,
} from './movement-definition-types.js';

export const movementRegistry: readonly MovementDefinition[] = movementCatalog.map((entry) => {
  const profile = movementProfiles[entry.type];

  if (!profile) {
    throw new Error(`Missing movement profile definition for ${entry.type}.`);
  }

  if (profile.maturity !== entry.maturity) {
    throw new Error(`Movement profile maturity mismatch for ${entry.type}.`);
  }

  return {
    ...entry,
    profile,
  };
});

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
