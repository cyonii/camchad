export type TemporalConfidenceState = 'inactive' | 'candidate' | 'active';

export interface TemporalConfidenceOptions {
  readonly activationThreshold: number;
  readonly deactivationThreshold: number;
  readonly candidateThreshold?: number;
  readonly riseAlpha?: number;
  readonly fallAlpha?: number;
}

export interface TemporalConfidenceSnapshot {
  readonly state: TemporalConfidenceState;
  readonly confidence: number;
  readonly sampleCount: number;
  readonly activeSampleCount: number;
}

const defaultRiseAlpha = 0.35;
const defaultFallAlpha = 0.55;

export class TemporalConfidenceAccumulator {
  private readonly activationThreshold: number;
  private readonly deactivationThreshold: number;
  private readonly candidateThreshold: number;
  private readonly riseAlpha: number;
  private readonly fallAlpha: number;
  private confidence = 0;
  private sampleCount = 0;
  private activeSampleCount = 0;
  private state: TemporalConfidenceState = 'inactive';

  public constructor(options: TemporalConfidenceOptions) {
    validateThresholds(options);

    this.activationThreshold = options.activationThreshold;
    this.deactivationThreshold = options.deactivationThreshold;
    this.candidateThreshold = options.candidateThreshold ?? options.deactivationThreshold;
    this.riseAlpha = options.riseAlpha ?? defaultRiseAlpha;
    this.fallAlpha = options.fallAlpha ?? defaultFallAlpha;
  }

  public addSample(rawConfidence: number): TemporalConfidenceSnapshot {
    const confidence = clamp01(rawConfidence);
    const alpha = confidence >= this.confidence ? this.riseAlpha : this.fallAlpha;

    this.confidence += (confidence - this.confidence) * alpha;
    this.sampleCount += 1;
    this.state = nextState(this.state, this.confidence, {
      activationThreshold: this.activationThreshold,
      candidateThreshold: this.candidateThreshold,
      deactivationThreshold: this.deactivationThreshold,
    });

    if (this.state === 'active') {
      this.activeSampleCount += 1;
    }

    return this.snapshot();
  }

  public reset(): void {
    this.confidence = 0;
    this.sampleCount = 0;
    this.activeSampleCount = 0;
    this.state = 'inactive';
  }

  public snapshot(): TemporalConfidenceSnapshot {
    return {
      state: this.state,
      confidence: this.confidence,
      sampleCount: this.sampleCount,
      activeSampleCount: this.activeSampleCount,
    };
  }
}

function nextState(
  currentState: TemporalConfidenceState,
  confidence: number,
  thresholds: {
    readonly activationThreshold: number;
    readonly candidateThreshold: number;
    readonly deactivationThreshold: number;
  },
): TemporalConfidenceState {
  if (currentState === 'active') {
    return confidence <= thresholds.deactivationThreshold ? 'candidate' : 'active';
  }

  if (confidence >= thresholds.activationThreshold) {
    return 'active';
  }

  if (confidence >= thresholds.candidateThreshold) {
    return 'candidate';
  }

  return 'inactive';
}

function validateThresholds(options: TemporalConfidenceOptions): void {
  const candidateThreshold = options.candidateThreshold ?? options.deactivationThreshold;

  for (const [name, value] of [
    ['activationThreshold', options.activationThreshold],
    ['deactivationThreshold', options.deactivationThreshold],
    ['candidateThreshold', candidateThreshold],
    ['riseAlpha', options.riseAlpha ?? defaultRiseAlpha],
    ['fallAlpha', options.fallAlpha ?? defaultFallAlpha],
  ] as const) {
    if (value < 0 || value > 1) {
      throw new Error(`${name} must be between 0 and 1.`);
    }
  }

  if (options.deactivationThreshold > options.activationThreshold) {
    throw new Error('deactivationThreshold must not exceed activationThreshold.');
  }

  if (
    candidateThreshold > options.activationThreshold ||
    candidateThreshold < options.deactivationThreshold
  ) {
    throw new Error('candidateThreshold must sit between deactivation and activation thresholds.');
  }
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}
