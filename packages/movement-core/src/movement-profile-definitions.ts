import type { MovementType } from './movement-interpreter.js';
import type {
  MovementBodyOrientation,
  MovementCategory,
  MovementMaturityLevel,
  MovementProfileCriterion,
  MovementProfileCriterionSource,
  MovementProfileMetadata,
  MovementFamilyPrimitive,
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
    family: 'cyclic_joint_flexion',
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
    family: 'cyclic_joint_flexion',
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
  sit_up: implementedProfile({
    category: 'repetition',
    bodyOrientation: 'floor',
    requiredRegions: ['torso', 'hips', 'legs'],
    primaryJoints: ['hip', 'spine', 'shoulder'],
    phaseModel: ['supine', 'curl', 'upright', 'return'],
    rhythm: 'cyclic',
    family: 'cyclic_joint_flexion',
    cameraSensitivity: 'medium',
    recognitionCriteria: [
      ['torso_curl_trajectory', 'Torso curl trajectory'],
      ['hip_anchor_stability', 'Hip anchor stability'],
    ],
    telemetrySignals: ['torso curl trajectory', 'hip anchor stability'],
    failureCriteria: ['tracking loss', 'hip anchor drift', 'low torso confidence'],
  }),
  lunge: implementedProfile({
    category: 'repetition',
    bodyOrientation: 'standing',
    requiredRegions: ['torso', 'hips', 'legs', 'feet'],
    primaryJoints: ['hip', 'knee', 'ankle'],
    phaseModel: ['standing', 'lowering', 'bottom', 'rising'],
    rhythm: 'cyclic',
    family: 'asymmetrical_stance',
    cameraSensitivity: 'medium',
    recognitionCriteria: [
      ['split_stance', 'Split stance'],
      ['front_knee_flexion', 'Front knee flexion'],
      ['hip_drop', 'Hip drop'],
    ],
    telemetrySignals: ['split stance', 'front knee flexion', 'hip drop'],
    failureCriteria: ['tracking loss', 'feet cropped', 'stance ambiguity'],
  }),
  jumping_jack: implementedProfile({
    category: 'repetition',
    bodyOrientation: 'standing',
    requiredRegions: ['torso', 'arms', 'legs', 'feet'],
    primaryJoints: ['shoulder', 'hip', 'ankle'],
    phaseModel: ['closed stance', 'abducting', 'open stance', 'returning'],
    rhythm: 'cyclic',
    family: 'span_oscillation',
    cameraSensitivity: 'medium',
    recognitionCriteria: [
      ['arm_leg_abduction_rhythm', 'Arm-leg abduction rhythm'],
      ['wrist_and_ankle_span_oscillation', 'Wrist and ankle span oscillation'],
    ],
    telemetrySignals: ['arm-leg abduction rhythm', 'wrist and ankle span oscillation'],
    failureCriteria: ['tracking loss', 'hands or feet cropped', 'low span contrast'],
  }),
  plank: implementedProfile({
    category: 'hold',
    bodyOrientation: 'floor',
    requiredRegions: ['torso', 'arms', 'hips', 'legs'],
    primaryJoints: ['shoulder', 'hip', 'knee'],
    phaseModel: ['setup', 'hold', 'release'],
    rhythm: 'hold',
    family: 'static_hold',
    cameraSensitivity: 'high',
    recognitionCriteria: [
      ['horizontal_body_line', 'Horizontal body line'],
      ['static_hold_stability', 'Static hold stability'],
    ],
    telemetrySignals: ['horizontal body line', 'static hold stability'],
    failureCriteria: ['tracking loss', 'body-line sag', 'unstable hold'],
  }),
  pull_up: implementedProfile({
    category: 'repetition',
    bodyOrientation: 'hanging',
    requiredRegions: ['torso', 'arms', 'hands'],
    primaryJoints: ['shoulder', 'elbow', 'wrist'],
    phaseModel: ['dead hang', 'pulling', 'top', 'lowering'],
    rhythm: 'cyclic',
    family: 'cyclic_joint_flexion',
    cameraSensitivity: 'high',
    recognitionCriteria: [
      ['vertical_hanging_posture', 'Vertical hanging posture'],
      ['elbow_flexion', 'Elbow flexion'],
      ['shoulder_elevation_change', 'Shoulder elevation change'],
    ],
    telemetrySignals: ['vertical hanging posture', 'elbow flexion', 'shoulder elevation change'],
    failureCriteria: ['tracking loss', 'hands cropped', 'bar occlusion'],
  }),
  burpee: implementedProfile({
    category: 'compound',
    bodyOrientation: 'mixed',
    requiredRegions: ['torso', 'arms', 'hips', 'legs', 'feet'],
    primaryJoints: ['shoulder', 'elbow', 'hip', 'knee'],
    phaseModel: ['standing', 'floor transition', 'floor position', 'standing return'],
    rhythm: 'compound',
    family: 'compound_transition',
    cameraSensitivity: 'high',
    recognitionCriteria: [
      ['standing_floor_standing_transition', 'Standing-floor-standing transition'],
      ['compound_motion_rhythm', 'Compound motion rhythm'],
    ],
    telemetrySignals: ['standing-floor-standing transition', 'compound motion rhythm'],
    failureCriteria: ['tracking loss', 'transition ambiguity', 'partial body visibility'],
  }),
  mountain_climber: implementedProfile({
    category: 'repetition',
    bodyOrientation: 'floor',
    requiredRegions: ['torso', 'arms', 'hips', 'legs'],
    primaryJoints: ['hip', 'knee', 'shoulder'],
    phaseModel: ['plank base', 'left drive', 'switch', 'right drive'],
    rhythm: 'cyclic',
    family: 'alternating_limb_drive',
    cameraSensitivity: 'high',
    recognitionCriteria: [
      ['plank_base', 'Plank base'],
      ['alternating_knee_drive', 'Alternating knee drive'],
    ],
    telemetrySignals: ['plank base', 'alternating knee drive'],
    failureCriteria: ['tracking loss', 'weak plank base', 'knee-drive ambiguity'],
  }),
  high_knees: implementedProfile({
    category: 'repetition',
    bodyOrientation: 'standing',
    requiredRegions: ['torso', 'hips', 'legs', 'feet'],
    primaryJoints: ['hip', 'knee', 'ankle'],
    phaseModel: ['standing', 'left drive', 'switch', 'right drive'],
    rhythm: 'cyclic',
    family: 'alternating_limb_drive',
    cameraSensitivity: 'medium',
    recognitionCriteria: [
      ['alternating_knee_lift', 'Alternating knee lift'],
      ['vertical_cadence', 'Vertical cadence'],
    ],
    telemetrySignals: ['alternating knee lift', 'vertical cadence'],
    failureCriteria: ['tracking loss', 'missed alternation', 'low knee lift'],
  }),
  lateral_raise: implementedProfile({
    category: 'repetition',
    bodyOrientation: 'standing',
    requiredRegions: ['torso', 'arms', 'hands'],
    primaryJoints: ['shoulder', 'elbow', 'wrist'],
    phaseModel: ['arms down', 'raising', 'top', 'lowering'],
    rhythm: 'cyclic',
    family: 'span_oscillation',
    cameraSensitivity: 'medium',
    recognitionCriteria: [
      ['shoulder_abduction', 'Shoulder abduction'],
      ['arm_elevation_symmetry', 'Arm elevation symmetry'],
    ],
    telemetrySignals: ['shoulder abduction', 'arm elevation symmetry'],
    failureCriteria: ['tracking loss', 'hands cropped', 'asymmetric elevation'],
  }),
  yoga_hold: implementedProfile({
    category: 'hold',
    bodyOrientation: 'mixed',
    requiredRegions: ['torso', 'arms', 'hips', 'legs', 'feet'],
    primaryJoints: ['shoulder', 'elbow', 'hip', 'knee'],
    phaseModel: ['setup', 'hold', 'release'],
    rhythm: 'hold',
    family: 'static_hold',
    cameraSensitivity: 'medium',
    recognitionCriteria: [
      ['static_pose_geometry', 'Static pose geometry'],
      ['hold_stability', 'Hold stability'],
    ],
    telemetrySignals: ['static pose geometry', 'hold stability'],
    failureCriteria: ['tracking loss', 'unstable pose geometry', 'low hold confidence'],
  }),
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
    family: familyForGeneratedProfile(category, bodyOrientation, analysisSignals),
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

function familyForGeneratedProfile(
  category: MovementCategory,
  bodyOrientation: MovementBodyOrientation,
  analysisSignals: readonly string[],
): MovementFamilyPrimitive {
  const signalText = analysisSignals.join(' ').toLowerCase();

  if (category === 'hold') {
    return 'static_hold';
  }

  if (category === 'compound' || bodyOrientation === 'mixed' || signalText.includes('transition')) {
    return 'compound_transition';
  }

  if (signalText.includes('alternating') || signalText.includes('single-leg')) {
    return 'alternating_limb_drive';
  }

  if (
    signalText.includes('span') ||
    signalText.includes('raise') ||
    signalText.includes('elevation') ||
    signalText.includes('lift')
  ) {
    return 'span_oscillation';
  }

  if (signalText.includes('split stance') || signalText.includes('stance')) {
    return 'asymmetrical_stance';
  }

  return 'cyclic_joint_flexion';
}

function implementedProfile(input: {
  readonly category: MovementCategory;
  readonly bodyOrientation: MovementBodyOrientation;
  readonly requiredRegions: readonly MovementRegion[];
  readonly primaryJoints: readonly string[];
  readonly phaseModel: readonly string[];
  readonly rhythm: MovementProfileMetadata['rhythm'];
  readonly family: MovementFamilyPrimitive;
  readonly cameraSensitivity: MovementProfileMetadata['cameraSensitivity'];
  readonly recognitionCriteria: readonly (readonly [key: string, label: string])[];
  readonly telemetrySignals: readonly string[];
  readonly failureCriteria: readonly string[];
}): MovementProfileMetadata {
  return {
    requiredRegions: input.requiredRegions,
    primaryJoints: input.primaryJoints,
    phaseModel: input.phaseModel,
    rhythm: input.rhythm,
    family: input.family,
    maturity: 'rep_counting',
    cameraSensitivity: input.cameraSensitivity,
    recognitionCriteria: input.recognitionCriteria.map(([key, label]) =>
      profileCriterion(key, label, 'declarative'),
    ),
    validationCriteria: [
      profileCriterion(
        'rep_validating_pending',
        'Rep-validating rules not implemented yet',
        'planned',
      ),
    ],
    telemetrySignals: input.telemetrySignals,
    telemetryExtractors: input.telemetrySignals.map((signal) =>
      telemetryExtractor(
        signalKey(signal),
        signal,
        'derived',
        `${signal} contributes to recognition confidence.`,
      ),
    ),
    failureCriteria: input.failureCriteria,
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
