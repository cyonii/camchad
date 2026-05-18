import type { CameraAngle, MovementType } from './movement-interpreter.js';

export interface MovementDefinition {
  readonly type: MovementType;
  readonly label: string;
  readonly pluralLabel: string;
  readonly repLabel: string;
  readonly repPluralLabel: string;
  readonly category: MovementCategory;
  readonly maturity: MovementMaturityLevel;
  readonly bodyOrientation: MovementBodyOrientation;
  readonly analysisSignals: readonly string[];
  readonly phaseLabels: readonly string[];
  readonly defaultCameraAngle: CameraAngle;
  readonly supportedCameraAngles: readonly CameraAngle[];
  readonly cameraGuidance: MovementCameraGuidance;
  readonly telemetryMetrics: readonly MovementTelemetryMetricDefinition[];
  readonly profile: MovementProfileMetadata;
}

export type MovementCategory = 'repetition' | 'hold' | 'compound';

export type MovementMaturityLevel =
  | 'detected'
  | 'recognized'
  | 'rep_counting'
  | 'rep_validating'
  | 'quality_validating'
  | 'planned';

export type MovementBodyOrientation = 'standing' | 'floor' | 'seated' | 'hanging' | 'mixed';

export type MovementRegion = 'head' | 'torso' | 'arms' | 'hands' | 'hips' | 'legs' | 'feet';

export type MovementRhythmType = 'cyclic' | 'hold' | 'compound' | 'unknown';

export type MovementFamilyPrimitive =
  | 'cyclic_joint_flexion'
  | 'alternating_limb_drive'
  | 'span_oscillation'
  | 'static_hold'
  | 'compound_transition'
  | 'asymmetrical_stance';

export type MovementCameraSensitivity = 'low' | 'medium' | 'high';

export interface MovementProfileMetadata {
  readonly requiredRegions: readonly MovementRegion[];
  readonly primaryJoints: readonly string[];
  readonly phaseModel: readonly string[];
  readonly rhythm: MovementRhythmType;
  readonly family: MovementFamilyPrimitive;
  readonly maturity: MovementMaturityLevel;
  readonly cameraSensitivity: MovementCameraSensitivity;
  readonly recognitionCriteria: readonly MovementProfileCriterion[];
  readonly validationCriteria: readonly MovementProfileCriterion[];
  readonly telemetrySignals: readonly string[];
  readonly telemetryExtractors: readonly MovementTelemetryExtractorDefinition[];
  readonly failureCriteria: readonly string[];
}

export type MovementProfileCriterionSource = 'declarative' | 'validation_profile' | 'planned';

export interface MovementProfileCriterion {
  readonly key: string;
  readonly label: string;
  readonly source: MovementProfileCriterionSource;
}

export type MovementTelemetryExtractorSource = 'metric' | 'derived' | 'planned';

export interface MovementTelemetryExtractorDefinition {
  readonly key: string;
  readonly label: string;
  readonly source: MovementTelemetryExtractorSource;
  readonly description: string;
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
  readonly unit: 'deg' | '%' | 's';
}
