import type { MovementType } from './movement-interpreter.js';
import type {
  MovementBodyOrientation,
  MovementCategory,
  MovementMaturityLevel,
  MovementProfileCriterion,
  MovementProfileCriterionSource,
  MovementProfileMetadata,
  MovementRegion,
  MovementTelemetryExtractorDefinition,
  MovementTelemetryExtractorSource,
} from './movement-definition-types.js';

export const movementProfiles: Readonly<Record<MovementType, MovementProfileMetadata>> = {
  push_up: {
    requiredRegions: ['torso', 'arms', 'hips', 'legs'],
    primaryJoints: ['elbow', 'shoulder', 'hip'],
    phaseModel: ['top', 'descending', 'bottom', 'ascending'],
    rhythm: 'cyclic',
    maturity: 'rep_validating',
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
        'validation_profile',
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
  squat: {
    requiredRegions: ['torso', 'hips', 'legs', 'feet'],
    primaryJoints: ['knee', 'hip', 'ankle'],
    phaseModel: ['standing', 'lowering', 'bottom', 'rising'],
    rhythm: 'cyclic',
    maturity: 'rep_validating',
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
        'validation_profile',
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
  sit_up: generatedProfile('recognizable', 'repetition', 'floor', [
    'torso curl trajectory',
    'hip anchor stability',
  ]),
  lunge: generatedProfile('recognizable', 'repetition', 'standing', [
    'split stance',
    'front knee flexion',
    'hip drop',
  ]),
  jumping_jack: generatedProfile('recognizable', 'repetition', 'standing', [
    'arm-leg abduction rhythm',
    'wrist and ankle span oscillation',
  ]),
  plank: generatedProfile('recognizable', 'hold', 'floor', [
    'horizontal body line',
    'static hold stability',
  ]),
  pull_up: generatedProfile('recognizable', 'repetition', 'hanging', [
    'vertical hanging posture',
    'elbow flexion',
    'shoulder elevation change',
  ]),
  burpee: generatedProfile('recognizable', 'repetition', 'mixed', [
    'standing-floor-standing transition',
    'compound motion rhythm',
  ]),
  mountain_climber: generatedProfile('recognizable', 'repetition', 'floor', [
    'plank base',
    'alternating knee drive',
  ]),
  high_knees: generatedProfile('recognizable', 'repetition', 'standing', [
    'alternating knee lift',
    'vertical cadence',
  ]),
  lateral_raise: generatedProfile('recognizable', 'repetition', 'standing', [
    'shoulder abduction',
    'arm elevation symmetry',
  ]),
  yoga_hold: generatedProfile('recognizable', 'hold', 'mixed', [
    'static pose geometry',
    'hold stability',
  ]),
  crunch: generatedProfile('planned', 'repetition', 'floor', [
    'abdominal curl definition pending',
    'shoulder elevation from floor',
  ]),
  leg_raise: generatedProfile('planned', 'repetition', 'floor', [
    'hip flexion definition pending',
    'leg elevation range',
  ]),
  glute_bridge: generatedProfile('planned', 'repetition', 'floor', [
    'hip extension definition pending',
    'shoulder-hip-knee line',
  ]),
  wall_sit: generatedProfile('planned', 'hold', 'seated', [
    'static squat hold definition pending',
    'knee angle stability',
  ]),
  calf_raise: generatedProfile('planned', 'repetition', 'standing', [
    'ankle extension definition pending',
    'heel lift rhythm',
  ]),
  step_up: generatedProfile('planned', 'repetition', 'standing', [
    'platform transition definition pending',
    'single-leg drive',
  ]),
  tricep_dip: generatedProfile('planned', 'repetition', 'floor', [
    'back-supported elbow flexion definition pending',
    'shoulder depth control',
  ]),
  bicep_curl: generatedProfile('planned', 'repetition', 'standing', [
    'elbow flexion definition pending',
    'arm isolation signal',
  ]),
  shoulder_press: generatedProfile('planned', 'repetition', 'standing', [
    'overhead press definition pending',
    'wrist elevation path',
  ]),
  deadlift: generatedProfile('planned', 'repetition', 'standing', [
    'hip hinge definition pending',
    'torso inclination recovery',
  ]),
  bear_crawl: generatedProfile('planned', 'repetition', 'floor', [
    'quadruped travel definition pending',
    'alternating limb rhythm',
  ]),
  side_plank: generatedProfile('planned', 'hold', 'floor', [
    'lateral body line definition pending',
    'static hold stability',
  ]),
  bird_dog: generatedProfile('planned', 'repetition', 'floor', [
    'contralateral limb extension definition pending',
    'spine stability',
  ]),
  superman_hold: generatedProfile('planned', 'hold', 'floor', [
    'prone extension definition pending',
    'static posterior-chain hold',
  ]),
  russian_twist: generatedProfile('planned', 'repetition', 'seated', [
    'torso rotation definition pending',
    'seated trunk rhythm',
  ]),
};

function generatedProfile(
  maturity: MovementMaturityLevel,
  category: MovementCategory,
  bodyOrientation: MovementBodyOrientation,
  analysisSignals: readonly string[],
): MovementProfileMetadata {
  return {
    requiredRegions: requiredRegionsFor(bodyOrientation),
    primaryJoints: primaryJointsFor(bodyOrientation),
    phaseModel:
      category === 'hold' ? ['setup', 'hold', 'release'] : ['setup', 'active movement', 'return'],
    rhythm: category === 'hold' ? 'hold' : category === 'compound' ? 'compound' : 'cyclic',
    maturity,
    cameraSensitivity: maturity === 'planned' ? 'high' : 'medium',
    recognitionCriteria: analysisSignals.map((signal) =>
      profileCriterion(
        signalKey(signal),
        signal,
        maturity === 'planned' ? 'planned' : 'declarative',
      ),
    ),
    validationCriteria:
      maturity === 'planned'
        ? [profileCriterion('planned', 'Movement profile not implemented', 'planned')]
        : [
            profileCriterion(
              'rep_validating_pending',
              'Rep-validating rules not implemented yet',
              'planned',
            ),
          ],
    telemetrySignals: analysisSignals,
    telemetryExtractors: analysisSignals.map((signal) =>
      telemetryExtractor(
        signalKey(signal),
        signal,
        maturity === 'planned' ? 'planned' : 'derived',
        maturity === 'planned'
          ? `${signal} is planned and not yet computed.`
          : `${signal} contributes to recognition confidence.`,
      ),
    ),
    failureCriteria:
      maturity === 'planned'
        ? ['movement profile not implemented']
        : ['tracking loss', 'low confidence', 'incomplete movement evidence'],
  };
}

function profileCriterion(
  key: string,
  label: string,
  source: MovementProfileCriterionSource,
): MovementProfileCriterion {
  return { key, label, source };
}

function telemetryExtractor(
  key: string,
  label: string,
  source: MovementTelemetryExtractorSource,
  description: string,
): MovementTelemetryExtractorDefinition {
  return { key, label, source, description };
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

function signalKey(signal: string): string {
  return signal
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '');
}
