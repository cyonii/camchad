import type { CameraAngle, MovementType } from './movement-interpreter.js';
import type {
  MovementBodyOrientation,
  MovementCameraGuidance,
  MovementCategory,
  MovementMaturityLevel,
  MovementTelemetryMetricDefinition,
} from './movement-definition-types.js';

export interface MovementCatalogEntry {
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
}

export const movementCatalog: readonly MovementCatalogEntry[] = [
  {
    type: 'push_up',
    label: 'Push-up',
    pluralLabel: 'Push-ups',
    repLabel: 'push-up',
    repPluralLabel: 'push-ups',
    category: 'repetition',
    maturity: 'rep_validating',
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
  },
  {
    type: 'squat',
    label: 'Squat',
    pluralLabel: 'Squats',
    repLabel: 'squat',
    repPluralLabel: 'squats',
    category: 'repetition',
    maturity: 'rep_validating',
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
  },
  countReadyCatalogEntry('sit_up', 'Sit-up', 'Sit-ups', 'floor', [
    'torso curl trajectory',
    'hip anchor stability',
  ]),
  countReadyCatalogEntry('lunge', 'Lunge', 'Lunges', 'standing', [
    'split stance',
    'front knee flexion',
    'hip drop',
  ]),
  countReadyCatalogEntry('jumping_jack', 'Jumping jack', 'Jumping jacks', 'standing', [
    'arm-leg abduction rhythm',
    'wrist and ankle span oscillation',
  ]),
  generatedCatalogEntry({
    type: 'plank',
    label: 'Plank',
    pluralLabel: 'Planks',
    category: 'hold',
    maturity: 'rep_validating',
    bodyOrientation: 'floor',
    analysisSignals: ['horizontal body line', 'static hold stability'],
    telemetryMetrics: [
      { key: 'holdSeconds', label: 'Hold time', unit: '%' },
      { key: 'bodyLineScore', label: 'Body line', unit: '%' },
      { key: 'movementConfidence', label: 'Signal', unit: '%' },
    ],
  }),
  countReadyCatalogEntry('pull_up', 'Pull-up', 'Pull-ups', 'hanging', [
    'vertical hanging posture',
    'elbow flexion',
    'shoulder elevation change',
  ]),
  countReadyCatalogEntry('burpee', 'Burpee', 'Burpees', 'mixed', [
    'standing-floor-standing transition',
    'compound motion rhythm',
  ]),
  countReadyCatalogEntry('mountain_climber', 'Mountain climber', 'Mountain climbers', 'floor', [
    'plank base',
    'alternating knee drive',
  ]),
  countReadyCatalogEntry('high_knees', 'High knees', 'High knees', 'standing', [
    'alternating knee lift',
    'vertical cadence',
  ]),
  countReadyCatalogEntry('lateral_raise', 'Lateral raise', 'Lateral raises', 'standing', [
    'shoulder abduction',
    'arm elevation symmetry',
  ]),
  countReadyCatalogEntry('yoga_hold', 'Yoga hold', 'Yoga holds', 'mixed', [
    'static pose geometry',
    'hold stability',
  ]),
  plannedCatalogEntry('crunch', 'Crunch', 'Crunches', 'floor', [
    'abdominal curl definition pending',
    'shoulder elevation from floor',
  ]),
  plannedCatalogEntry('leg_raise', 'Leg raise', 'Leg raises', 'floor', [
    'hip flexion definition pending',
    'leg elevation range',
  ]),
  plannedCatalogEntry('glute_bridge', 'Glute bridge', 'Glute bridges', 'floor', [
    'hip extension definition pending',
    'shoulder-hip-knee line',
  ]),
  plannedCatalogEntry('wall_sit', 'Wall sit', 'Wall sits', 'seated', [
    'static squat hold definition pending',
    'knee angle stability',
  ]),
  plannedCatalogEntry('calf_raise', 'Calf raise', 'Calf raises', 'standing', [
    'ankle extension definition pending',
    'heel lift rhythm',
  ]),
  plannedCatalogEntry('step_up', 'Step-up', 'Step-ups', 'standing', [
    'platform transition definition pending',
    'single-leg drive',
  ]),
  plannedCatalogEntry('tricep_dip', 'Tricep dip', 'Tricep dips', 'floor', [
    'back-supported elbow flexion definition pending',
    'shoulder depth control',
  ]),
  plannedCatalogEntry('bicep_curl', 'Bicep curl', 'Bicep curls', 'standing', [
    'elbow flexion definition pending',
    'arm isolation signal',
  ]),
  plannedCatalogEntry('shoulder_press', 'Shoulder press', 'Shoulder presses', 'standing', [
    'overhead press definition pending',
    'wrist elevation path',
  ]),
  plannedCatalogEntry('deadlift', 'Deadlift', 'Deadlifts', 'standing', [
    'hip hinge definition pending',
    'torso inclination recovery',
  ]),
  plannedCatalogEntry('bear_crawl', 'Bear crawl', 'Bear crawls', 'floor', [
    'quadruped travel definition pending',
    'alternating limb rhythm',
  ]),
  plannedCatalogEntry('side_plank', 'Side plank', 'Side planks', 'floor', [
    'lateral body line definition pending',
    'static hold stability',
  ]),
  plannedCatalogEntry('bird_dog', 'Bird dog', 'Bird dogs', 'floor', [
    'contralateral limb extension definition pending',
    'spine stability',
  ]),
  plannedCatalogEntry('superman_hold', 'Superman hold', 'Superman holds', 'floor', [
    'prone extension definition pending',
    'static posterior-chain hold',
  ]),
  plannedCatalogEntry('russian_twist', 'Russian twist', 'Russian twists', 'seated', [
    'torso rotation definition pending',
    'seated trunk rhythm',
  ]),
];

function countReadyCatalogEntry(
  type: MovementType,
  label: string,
  pluralLabel: string,
  bodyOrientation: MovementBodyOrientation,
  analysisSignals: readonly string[],
): MovementCatalogEntry {
  const category = type === 'plank' || type === 'yoga_hold' ? 'hold' : 'repetition';

  return generatedCatalogEntry({
    type,
    label,
    pluralLabel,
    category,
    maturity: 'rep_counting',
    bodyOrientation,
    analysisSignals,
    telemetryMetrics: [
      { key: 'movementConfidence', label: 'Signal', unit: '%' },
      { key: 'rangeOfMotionScore', label: 'Range', unit: '%' },
    ],
  });
}

function plannedCatalogEntry(
  type: MovementType,
  label: string,
  pluralLabel: string,
  bodyOrientation: MovementBodyOrientation,
  analysisSignals: readonly string[],
): MovementCatalogEntry {
  return generatedCatalogEntry({
    type,
    label,
    pluralLabel,
    category:
      type.includes('hold') || type === 'wall_sit' || type === 'side_plank' ? 'hold' : 'repetition',
    maturity: 'planned',
    bodyOrientation,
    analysisSignals,
    telemetryMetrics: [],
  });
}

function generatedCatalogEntry(input: {
  readonly type: MovementType;
  readonly label: string;
  readonly pluralLabel: string;
  readonly category: MovementCategory;
  readonly maturity: MovementMaturityLevel;
  readonly bodyOrientation: MovementBodyOrientation;
  readonly analysisSignals: readonly string[];
  readonly telemetryMetrics: readonly MovementTelemetryMetricDefinition[];
}): MovementCatalogEntry {
  return {
    type: input.type,
    label: input.label,
    pluralLabel: input.pluralLabel,
    repLabel: input.label.toLowerCase(),
    repPluralLabel: input.pluralLabel.toLowerCase(),
    category: input.category,
    maturity: input.maturity,
    bodyOrientation: input.bodyOrientation,
    analysisSignals: input.analysisSignals,
    phaseLabels: [],
    defaultCameraAngle: input.bodyOrientation === 'standing' ? 'front' : 'side',
    supportedCameraAngles:
      input.bodyOrientation === 'standing' ? ['front', 'side'] : ['side', 'front_diagonal'],
    cameraGuidance: {
      recommendedAngle: input.bodyOrientation === 'standing' ? 'front' : 'side',
      usableTitle: input.maturity === 'planned' ? 'Definition pending' : 'Camera angle usable',
      usableMessage:
        input.maturity === 'planned'
          ? `${input.label} is listed as a future exercise and is not recognized yet.`
          : `Keep your body fully visible for ${input.label.toLowerCase()} analysis.`,
      warningTitle: input.maturity === 'planned' ? 'Not defined yet' : 'Adjust camera angle',
      warningMessage:
        input.maturity === 'planned'
          ? `${input.label} needs a movement definition before the engine can recognize it.`
          : `${input.label} analysis will need a clearer camera angle before rep validation is enabled.`,
    },
    telemetryMetrics: input.telemetryMetrics,
  };
}
