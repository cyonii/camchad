import type { CameraAngle, MovementInterpreter, MovementType } from './movement-interpreter.js';
import { defaultPushUpConfig, PushUpMovementInterpreter } from './push-up-interpreter.js';
import {
  createRecognitionMovementInterpreter,
  type RecognitionMovementType,
} from './recognition-movement-interpreters.js';
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
  readonly profile: MovementProfileMetadata;
  readonly createInterpreter?: (options?: MovementInterpreterFactoryOptions) => MovementInterpreter;
}

export type MovementCategory = 'repetition' | 'hold' | 'compound';

export type MovementSupportLevel = 'validation' | 'recognition' | 'planned';

export type MovementBodyOrientation = 'standing' | 'floor' | 'seated' | 'hanging' | 'mixed';

export type MovementRegion = 'head' | 'torso' | 'arms' | 'hands' | 'hips' | 'legs' | 'feet';

export type MovementRhythmType = 'cyclic' | 'hold' | 'compound' | 'unknown';

export type MovementValidationReadiness = 'rep_validation' | 'recognition_only' | 'profile_pending';

export type MovementCameraSensitivity = 'low' | 'medium' | 'high';

export interface MovementProfileMetadata {
  readonly requiredRegions: readonly MovementRegion[];
  readonly primaryJoints: readonly string[];
  readonly phaseModel: readonly string[];
  readonly rhythm: MovementRhythmType;
  readonly validationReadiness: MovementValidationReadiness;
  readonly cameraSensitivity: MovementCameraSensitivity;
  readonly recognitionCriteria: readonly MovementProfileCriterion[];
  readonly validationCriteria: readonly MovementProfileCriterion[];
  readonly telemetrySignals: readonly string[];
  readonly telemetryExtractors: readonly MovementTelemetryExtractorDefinition[];
  readonly failureCriteria: readonly string[];
}

export type MovementProfileCriterionSource = 'declarative' | 'custom_validator' | 'planned';

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
    profile: {
      requiredRegions: ['torso', 'arms', 'hips', 'legs'],
      primaryJoints: ['elbow', 'shoulder', 'hip'],
      phaseModel: ['top', 'descending', 'bottom', 'ascending'],
      rhythm: 'cyclic',
      validationReadiness: 'rep_validation',
      cameraSensitivity: 'high',
      recognitionCriteria: [
        profileCriterion('floor_orientation', 'Floor-oriented torso', 'declarative'),
        profileCriterion('elbow_flexion_signal', 'Elbow flexion signal', 'declarative'),
        profileCriterion('body_line_signal', 'Body-line signal', 'declarative'),
      ],
      validationCriteria: [
        profileCriterion(
          'push_up_phase_machine',
          'Top-bottom-top phase validation',
          'custom_validator',
        ),
        profileCriterion('push_up_depth', 'Elbow depth threshold', 'declarative'),
        profileCriterion('body_line_quality', 'Shoulder-hip-ankle line quality', 'declarative'),
      ],
      telemetrySignals: [
        'elbow angle',
        'elbow velocity',
        'body line deviation',
        'range of motion',
        'temporal confidence',
      ],
      telemetryExtractors: [
        telemetryExtractor('primaryJointAngle', 'Elbow angle', 'metric', 'Current elbow angle.'),
        telemetryExtractor(
          'primaryJointRange',
          'Elbow range',
          'metric',
          'Observed elbow-angle range across the rolling movement window.',
        ),
        telemetryExtractor(
          'bodyLineScore',
          'Body-line score',
          'metric',
          'Shoulder-hip-ankle alignment quality.',
        ),
        telemetryExtractor(
          'rhythmScore',
          'Rhythm score',
          'metric',
          'Cyclic consistency of the elbow-flexion signal.',
        ),
      ],
      failureCriteria: ['tracking loss', 'severe body-line drift', 'partial depth'],
    },
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
    profile: {
      requiredRegions: ['torso', 'hips', 'legs', 'feet'],
      primaryJoints: ['knee', 'hip', 'ankle'],
      phaseModel: ['standing', 'lowering', 'bottom', 'rising'],
      rhythm: 'cyclic',
      validationReadiness: 'rep_validation',
      cameraSensitivity: 'medium',
      recognitionCriteria: [
        profileCriterion('standing_orientation', 'Standing torso orientation', 'declarative'),
        profileCriterion('knee_flexion_signal', 'Knee flexion signal', 'declarative'),
        profileCriterion('hip_level_change', 'Hip level change', 'declarative'),
      ],
      validationCriteria: [
        profileCriterion(
          'squat_phase_machine',
          'Standing-bottom-standing phase validation',
          'custom_validator',
        ),
        profileCriterion('squat_depth', 'Knee depth threshold', 'declarative'),
        profileCriterion('torso_control', 'Torso control threshold', 'declarative'),
      ],
      telemetrySignals: [
        'knee angle',
        'knee velocity',
        'torso inclination',
        'range of motion',
        'temporal confidence',
      ],
      telemetryExtractors: [
        telemetryExtractor('primaryJointAngle', 'Knee angle', 'metric', 'Current knee angle.'),
        telemetryExtractor(
          'primaryJointRange',
          'Knee range',
          'metric',
          'Observed knee-angle range across the rolling movement window.',
        ),
        telemetryExtractor(
          'postureScore',
          'Torso control',
          'metric',
          'Torso posture quality during the squat pattern.',
        ),
        telemetryExtractor(
          'rhythmScore',
          'Rhythm score',
          'metric',
          'Cyclic consistency of the knee-flexion signal.',
        ),
      ],
      failureCriteria: ['tracking loss', 'forward torso collapse', 'partial depth'],
    },
    createInterpreter: (options) =>
      new SquatMovementInterpreter({
        ...defaultSquatConfig,
        cameraAngle: options?.cameraAngle ?? defaultSquatConfig.cameraAngle,
      }),
  },
  recognitionExercise('sit_up', 'Sit-up', 'Sit-ups', 'floor', [
    'torso curl trajectory',
    'hip anchor stability',
  ]),
  recognitionExercise('lunge', 'Lunge', 'Lunges', 'standing', [
    'split stance',
    'front knee flexion',
    'hip drop',
  ]),
  recognitionExercise('jumping_jack', 'Jumping jack', 'Jumping jacks', 'standing', [
    'arm-leg abduction rhythm',
    'wrist and ankle span oscillation',
  ]),
  recognitionExercise('plank', 'Plank', 'Planks', 'floor', [
    'horizontal body line',
    'static hold stability',
  ]),
  recognitionExercise('pull_up', 'Pull-up', 'Pull-ups', 'hanging', [
    'vertical hanging posture',
    'elbow flexion',
    'shoulder elevation change',
  ]),
  recognitionExercise('burpee', 'Burpee', 'Burpees', 'mixed', [
    'standing-floor-standing transition',
    'compound motion rhythm',
  ]),
  recognitionExercise('mountain_climber', 'Mountain climber', 'Mountain climbers', 'floor', [
    'plank base',
    'alternating knee drive',
  ]),
  recognitionExercise('high_knees', 'High knees', 'High knees', 'standing', [
    'alternating knee lift',
    'vertical cadence',
  ]),
  recognitionExercise('lateral_raise', 'Lateral raise', 'Lateral raises', 'standing', [
    'shoulder abduction',
    'arm elevation symmetry',
  ]),
  recognitionExercise('yoga_hold', 'Yoga hold', 'Yoga holds', 'mixed', [
    'static pose geometry',
    'hold stability',
  ]),
  plannedExercise('crunch', 'Crunch', 'Crunches', 'floor', [
    'abdominal curl definition pending',
    'shoulder elevation from floor',
  ]),
  plannedExercise('leg_raise', 'Leg raise', 'Leg raises', 'floor', [
    'hip flexion definition pending',
    'leg elevation range',
  ]),
  plannedExercise('glute_bridge', 'Glute bridge', 'Glute bridges', 'floor', [
    'hip extension definition pending',
    'shoulder-hip-knee line',
  ]),
  plannedExercise('wall_sit', 'Wall sit', 'Wall sits', 'seated', [
    'static squat hold definition pending',
    'knee angle stability',
  ]),
  plannedExercise('calf_raise', 'Calf raise', 'Calf raises', 'standing', [
    'ankle extension definition pending',
    'heel lift rhythm',
  ]),
  plannedExercise('step_up', 'Step-up', 'Step-ups', 'standing', [
    'platform transition definition pending',
    'single-leg drive',
  ]),
  plannedExercise('tricep_dip', 'Tricep dip', 'Tricep dips', 'floor', [
    'back-supported elbow flexion definition pending',
    'shoulder depth control',
  ]),
  plannedExercise('bicep_curl', 'Bicep curl', 'Bicep curls', 'standing', [
    'elbow flexion definition pending',
    'arm isolation signal',
  ]),
  plannedExercise('shoulder_press', 'Shoulder press', 'Shoulder presses', 'standing', [
    'overhead press definition pending',
    'wrist elevation path',
  ]),
  plannedExercise('deadlift', 'Deadlift', 'Deadlifts', 'standing', [
    'hip hinge definition pending',
    'torso inclination recovery',
  ]),
  plannedExercise('bear_crawl', 'Bear crawl', 'Bear crawls', 'floor', [
    'quadruped travel definition pending',
    'alternating limb rhythm',
  ]),
  plannedExercise('side_plank', 'Side plank', 'Side planks', 'floor', [
    'lateral body line definition pending',
    'static hold stability',
  ]),
  plannedExercise('bird_dog', 'Bird dog', 'Bird dogs', 'floor', [
    'contralateral limb extension definition pending',
    'spine stability',
  ]),
  plannedExercise('superman_hold', 'Superman hold', 'Superman holds', 'floor', [
    'prone extension definition pending',
    'static posterior-chain hold',
  ]),
  plannedExercise('russian_twist', 'Russian twist', 'Russian twists', 'seated', [
    'torso rotation definition pending',
    'seated trunk rhythm',
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

function recognitionExercise(
  type: RecognitionMovementType,
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
    supportLevel: 'recognition',
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
    profile: profileFor({
      supportLevel: 'recognition',
      category: type === 'plank' || type === 'yoga_hold' ? 'hold' : 'repetition',
      bodyOrientation,
      analysisSignals,
    }),
    createInterpreter: () => createRecognitionMovementInterpreter(type),
  };
}

function plannedExercise(
  type: MovementType,
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
    category:
      type.includes('hold') || type === 'wall_sit' || type === 'side_plank' ? 'hold' : 'repetition',
    supportLevel: 'planned',
    bodyOrientation,
    analysisSignals,
    phaseLabels: [],
    defaultCameraAngle: bodyOrientation === 'standing' ? 'front' : 'side',
    supportedCameraAngles:
      bodyOrientation === 'standing' ? ['front', 'side'] : ['side', 'front_diagonal'],
    cameraGuidance: {
      recommendedAngle: bodyOrientation === 'standing' ? 'front' : 'side',
      usableTitle: 'Definition pending',
      usableMessage: `${label} is listed as a future exercise and is not recognized yet.`,
      warningTitle: 'Not defined yet',
      warningMessage: `${label} needs a movement definition before the engine can recognize it.`,
    },
    telemetryMetrics: [],
    profile: profileFor({
      supportLevel: 'planned',
      category:
        type.includes('hold') || type === 'wall_sit' || type === 'side_plank'
          ? 'hold'
          : 'repetition',
      bodyOrientation,
      analysisSignals,
    }),
  };
}

function profileFor(options: {
  readonly supportLevel: MovementSupportLevel;
  readonly category: MovementCategory;
  readonly bodyOrientation: MovementBodyOrientation;
  readonly analysisSignals: readonly string[];
}): MovementProfileMetadata {
  return {
    requiredRegions: requiredRegionsFor(options.bodyOrientation),
    primaryJoints: primaryJointsFor(options.bodyOrientation),
    phaseModel:
      options.category === 'hold'
        ? ['setup', 'hold', 'release']
        : ['setup', 'active movement', 'return'],
    rhythm:
      options.category === 'hold'
        ? 'hold'
        : options.category === 'compound'
          ? 'compound'
          : 'cyclic',
    validationReadiness:
      options.supportLevel === 'validation'
        ? 'rep_validation'
        : options.supportLevel === 'recognition'
          ? 'recognition_only'
          : 'profile_pending',
    cameraSensitivity: options.supportLevel === 'planned' ? 'high' : 'medium',
    recognitionCriteria: options.analysisSignals.map((signal) =>
      profileCriterion(
        signal
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, '_')
          .replaceAll(/^_|_$/g, ''),
        signal,
        options.supportLevel === 'planned' ? 'planned' : 'declarative',
      ),
    ),
    validationCriteria:
      options.supportLevel === 'planned'
        ? [profileCriterion('profile_pending', 'Movement profile not implemented', 'planned')]
        : [
            profileCriterion(
              'validation_pending',
              'Validation rules not implemented yet',
              'planned',
            ),
          ],
    telemetrySignals: options.analysisSignals,
    telemetryExtractors: options.analysisSignals.map((signal) =>
      telemetryExtractor(
        signal
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, '_')
          .replaceAll(/^_|_$/g, ''),
        signal,
        options.supportLevel === 'planned' ? 'planned' : 'derived',
        options.supportLevel === 'planned'
          ? `${signal} is planned and not yet computed.`
          : `${signal} contributes to recognition confidence.`,
      ),
    ),
    failureCriteria:
      options.supportLevel === 'planned'
        ? ['movement profile not implemented']
        : ['tracking loss', 'low confidence', 'incomplete movement evidence'],
  };
}

function profileCriterion(
  key: string,
  label: string,
  source: MovementProfileCriterionSource,
): MovementProfileCriterion {
  return {
    key,
    label,
    source,
  };
}

function telemetryExtractor(
  key: string,
  label: string,
  source: MovementTelemetryExtractorSource,
  description: string,
): MovementTelemetryExtractorDefinition {
  return {
    key,
    label,
    source,
    description,
  };
}

function requiredRegionsFor(bodyOrientation: MovementBodyOrientation): readonly MovementRegion[] {
  switch (bodyOrientation) {
    case 'standing':
      return ['torso', 'hips', 'legs', 'feet'];
    case 'floor':
      return ['torso', 'arms', 'hips', 'legs'];
    case 'seated':
      return ['torso', 'hips', 'legs'];
    case 'hanging':
      return ['torso', 'arms', 'hands'];
    case 'mixed':
      return ['torso', 'arms', 'hips', 'legs', 'feet'];
  }
}

function primaryJointsFor(bodyOrientation: MovementBodyOrientation): readonly string[] {
  switch (bodyOrientation) {
    case 'standing':
      return ['hip', 'knee', 'ankle'];
    case 'floor':
      return ['shoulder', 'elbow', 'hip', 'knee'];
    case 'seated':
      return ['hip', 'spine', 'shoulder'];
    case 'hanging':
      return ['shoulder', 'elbow', 'wrist'];
    case 'mixed':
      return ['shoulder', 'elbow', 'hip', 'knee'];
  }
}
