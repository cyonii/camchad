import type {
  CameraAngle,
  ExerciseType,
  MovementInterpreter,
  MovementType,
} from './movement-interpreter.js';
import { defaultPushUpConfig, PushUpMovementInterpreter } from './push-up-interpreter.js';
import { defaultSquatConfig, SquatMovementInterpreter } from './squat-interpreter.js';

export interface MovementDefinition {
  readonly type: MovementType;
  readonly label: string;
  readonly pluralLabel: string;
  readonly repLabel: string;
  readonly repPluralLabel: string;
  readonly category: MovementCategory;
  readonly supportLevel: MovementSupportLevel;
  readonly bodyOrientation: MovementBodyOrientation;
  readonly analysisSignals: readonly string[];
  readonly phaseLabels: readonly string[];
  readonly defaultCameraAngle: CameraAngle;
  readonly supportedCameraAngles: readonly CameraAngle[];
  readonly cameraGuidance: MovementCameraGuidance;
  readonly telemetryMetrics: readonly MovementTelemetryMetricDefinition[];
  readonly createInterpreter?: (options?: MovementInterpreterFactoryOptions) => MovementInterpreter;
}

export type MovementCategory = 'repetition' | 'hold' | 'compound';

export type MovementSupportLevel = 'validation' | 'recognition' | 'planned';

export type MovementBodyOrientation = 'standing' | 'floor' | 'seated' | 'hanging' | 'mixed';

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
  readonly movementType: ExerciseType;
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
    category: 'repetition',
    supportLevel: 'validation',
    bodyOrientation: 'floor',
    analysisSignals: [
      'horizontal torso orientation',
      'elbow flexion and extension',
      'shoulder-hip-ankle line stability',
      'top-bottom-top phase rhythm',
    ],
    phaseLabels: ['top', 'descending', 'bottom', 'ascending'],
    defaultCameraAngle: 'side',
    supportedCameraAngles: ['side', 'front_diagonal'],
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
  {
    type: 'squat',
    label: 'Squat',
    pluralLabel: 'Squats',
    repLabel: 'squat',
    repPluralLabel: 'squats',
    category: 'repetition',
    supportLevel: 'validation',
    bodyOrientation: 'standing',
    analysisSignals: [
      'vertical torso orientation',
      'knee flexion and extension',
      'hip level change',
      'standing-bottom-standing phase rhythm',
    ],
    phaseLabels: ['standing', 'lowering', 'bottom', 'rising'],
    defaultCameraAngle: 'side',
    supportedCameraAngles: ['side', 'front', 'front_diagonal'],
    cameraGuidance: {
      recommendedAngle: 'side',
      usableTitle: 'Camera angle usable',
      usableMessage: 'Keep your full body visible so knee depth and torso control stay measurable.',
      warningTitle: 'Prefer side view',
      warningMessage:
        'Squat depth and torso-control checks are most reliable from a clean side angle.',
    },
    telemetryMetrics: [
      { key: 'primaryJointAngle', label: 'Primary joint', unit: 'deg' },
      { key: 'rangeOfMotionScore', label: 'Range', unit: '%' },
      { key: 'postureScore', label: 'Posture', unit: '%' },
      { key: 'movementConfidence', label: 'Signal', unit: '%' },
    ],
    createInterpreter: (options) =>
      new SquatMovementInterpreter({
        ...defaultSquatConfig,
        cameraAngle: options?.cameraAngle ?? defaultSquatConfig.cameraAngle,
      }),
  },
  plannedExercise('sit_up', 'Sit-up', 'Sit-ups', 'floor', [
    'torso curl trajectory',
    'hip anchor stability',
  ]),
  plannedExercise('lunge', 'Lunge', 'Lunges', 'standing', [
    'split stance',
    'front knee flexion',
    'hip drop',
  ]),
  plannedExercise('jumping_jack', 'Jumping jack', 'Jumping jacks', 'standing', [
    'arm-leg abduction rhythm',
    'wrist and ankle span oscillation',
  ]),
  plannedExercise('plank', 'Plank', 'Planks', 'floor', [
    'horizontal body line',
    'static hold stability',
  ]),
  plannedExercise('pull_up', 'Pull-up', 'Pull-ups', 'hanging', [
    'vertical hanging posture',
    'elbow flexion',
    'shoulder elevation change',
  ]),
  plannedExercise('burpee', 'Burpee', 'Burpees', 'mixed', [
    'standing-floor-standing transition',
    'compound motion rhythm',
  ]),
  plannedExercise('mountain_climber', 'Mountain climber', 'Mountain climbers', 'floor', [
    'plank base',
    'alternating knee drive',
  ]),
  plannedExercise('high_knees', 'High knees', 'High knees', 'standing', [
    'alternating knee lift',
    'vertical cadence',
  ]),
  plannedExercise('lateral_raise', 'Lateral raise', 'Lateral raises', 'standing', [
    'shoulder abduction',
    'arm elevation symmetry',
  ]),
  plannedExercise('yoga_hold', 'Yoga hold', 'Yoga holds', 'mixed', [
    'static pose geometry',
    'hold stability',
  ]),
];

export function movementDefinitionFor(type: MovementType): MovementDefinition {
  const definition = movementRegistry.find((movement) => movement.type === type);

  if (!definition) {
    throw new Error(`Unsupported movement type: ${type}`);
  }

  return definition;
}

export function cameraAdviceFor(
  movementType: ExerciseType,
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

function plannedExercise(
  type: ExerciseType,
  label: string,
  pluralLabel: string,
  bodyOrientation: MovementBodyOrientation,
  analysisSignals: readonly string[],
): MovementDefinition {
  return {
    type,
    label,
    pluralLabel,
    repLabel: label.toLowerCase(),
    repPluralLabel: pluralLabel.toLowerCase(),
    category: type === 'plank' || type === 'yoga_hold' ? 'hold' : 'repetition',
    supportLevel: 'planned',
    bodyOrientation,
    analysisSignals,
    phaseLabels: [],
    defaultCameraAngle: bodyOrientation === 'standing' ? 'front' : 'side',
    supportedCameraAngles:
      bodyOrientation === 'standing' ? ['front', 'side'] : ['side', 'front_diagonal'],
    cameraGuidance: {
      recommendedAngle: bodyOrientation === 'standing' ? 'front' : 'side',
      usableTitle: 'Camera angle usable',
      usableMessage: `Keep your body fully visible for ${label.toLowerCase()} analysis.`,
      warningTitle: 'Adjust camera angle',
      warningMessage: `${label} analysis will need a clearer camera angle before validation is enabled.`,
    },
    telemetryMetrics: [
      { key: 'movementConfidence', label: 'Signal', unit: '%' },
      { key: 'rangeOfMotionScore', label: 'Range', unit: '%' },
    ],
  };
}
