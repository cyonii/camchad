import type { PerceptionCapabilityFlags } from './perception-capabilities.js';
import {
  enabledPerceptionCapabilities,
  type PerceptionCapability,
} from './perception-capabilities.js';

export type PerceptionEvaluationStatus = 'baseline' | 'prototype' | 'disabled';

export interface PerceptionEvaluation {
  readonly capability: PerceptionCapability;
  readonly status: PerceptionEvaluationStatus;
  readonly productUse: string;
  readonly recommendation: string;
}

export function evaluatePerceptionCapabilities(
  flags: Partial<PerceptionCapabilityFlags> = {},
): readonly PerceptionEvaluation[] {
  const enabled = new Set(enabledPerceptionCapabilities(flags));

  return perceptionCapabilityCatalog.map((entry) => ({
    capability: entry.capability,
    status: entry.baseline ? 'baseline' : enabled.has(entry.capability) ? 'prototype' : 'disabled',
    productUse: entry.productUse,
    recommendation: entry.recommendation,
  }));
}

const perceptionCapabilityCatalog: readonly (Omit<PerceptionEvaluation, 'status'> & {
  readonly baseline?: boolean;
})[] = [
  {
    capability: 'pose_landmarks',
    baseline: true,
    productUse: 'Primary 33-landmark body skeleton for movement interpretation.',
    recommendation: 'Keep as the default perception layer until measured evidence says otherwise.',
  },
  {
    capability: 'pose_world_landmarks',
    baseline: true,
    productUse: 'Depth-aware body geometry where MediaPipe world landmarks are stable enough.',
    recommendation: 'Use as an optional quality signal, never as the only source of truth.',
  },
  {
    capability: 'pose_segmentation',
    productUse: 'Person coverage and occlusion diagnostics.',
    recommendation: 'Evaluate against poor framing and clutter before enabling by default.',
  },
  {
    capability: 'holistic_landmarks',
    productUse: 'Combined pose, face, and hands for richer body-state experiments.',
    recommendation: 'Keep behind a prototype flag because runtime cost may not improve core reps.',
  },
  {
    capability: 'hand_landmarks',
    productUse: 'Wrist/finger articulation for hand-sensitive movements.',
    recommendation: 'Activate selectively from movement profiles that explicitly need hand detail.',
  },
  {
    capability: 'face_landmarks',
    productUse: 'Head orientation and face-direction diagnostics.',
    recommendation:
      'Use only when it improves camera guidance and avoid invasive product language.',
  },
  {
    capability: 'person_segmentation',
    productUse: 'Dedicated person mask for body coverage and occlusion analysis.',
    recommendation: 'Compare against Pose segmentation before adding another runtime model.',
  },
  {
    capability: 'onnx_runtime',
    productUse:
      'Local model-backed action classification, depth, segmentation, or quality scoring.',
    recommendation: 'Introduce only for a concrete model with measured accuracy/performance gains.',
  },
];
