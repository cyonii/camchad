import type { BodyState } from './body-state.js';

export type MovementDirection = 'increasing' | 'decreasing' | 'stable' | 'unknown';

export interface MovementWindowOptions {
  readonly maxAgeMs: number;
  readonly maxSamples?: number;
}

export interface MovementWindowSample {
  readonly timestampMs: number;
  readonly bodyState?: BodyState;
}

export interface ValidMovementWindowSample extends MovementWindowSample {
  readonly bodyState: BodyState;
}

export interface SignalVelocity {
  readonly valuePerSecond: number;
  readonly direction: MovementDirection;
  readonly fromTimestampMs: number;
  readonly toTimestampMs: number;
}

export interface SignalStats {
  readonly min: number;
  readonly max: number;
  readonly average: number;
  readonly range: number;
  readonly sampleCount: number;
}

export interface SignalRhythm {
  readonly cycleCount: number;
  readonly amplitude: number;
  readonly averageCycleMs?: number;
  readonly cycleDurationRangeMs: number;
  readonly tempoDriftRatio: number;
  readonly rhythmScore: number;
  readonly sampleCount: number;
}

export interface MovementWindowSnapshot {
  readonly samples: readonly MovementWindowSample[];
  readonly validSamples: readonly ValidMovementWindowSample[];
  readonly latest?: MovementWindowSample;
  readonly latestValid?: ValidMovementWindowSample;
  readonly previousValid?: ValidMovementWindowSample;
  readonly durationMs: number;
  readonly averageConfidence: number;
  readonly missingSampleCount: number;
  readonly missingSampleRatio: number;
}

export class MovementWindow {
  private readonly maxAgeMs: number;
  private readonly maxSamples: number;
  private samples: MovementWindowSample[] = [];

  public constructor(options: MovementWindowOptions) {
    if (options.maxAgeMs <= 0) {
      throw new Error('MovementWindow maxAgeMs must be greater than zero.');
    }

    this.maxAgeMs = options.maxAgeMs;
    this.maxSamples = options.maxSamples ?? 120;
  }

  public add(bodyState: BodyState): MovementWindowSnapshot {
    return this.addSample({
      timestampMs: bodyState.timestampMs,
      bodyState,
    });
  }

  public addMissing(timestampMs: number): MovementWindowSnapshot {
    return this.addSample({ timestampMs });
  }

  public reset(): void {
    this.samples = [];
  }

  public snapshot(): MovementWindowSnapshot {
    const validSamples = this.samples.filter(hasBodyState);
    const latest = this.samples.at(-1);
    const latestValid = validSamples.at(-1);
    const previousValid = validSamples.at(-2);
    const first = this.samples[0];
    const durationMs = first && latest ? latest.timestampMs - first.timestampMs : 0;

    return {
      samples: this.samples,
      validSamples,
      latest,
      latestValid,
      previousValid,
      durationMs,
      averageConfidence: average(validSamples.map((sample) => sample.bodyState.confidence)),
      missingSampleCount: this.samples.length - validSamples.length,
      missingSampleRatio:
        this.samples.length === 0
          ? 0
          : (this.samples.length - validSamples.length) / this.samples.length,
    };
  }

  public signalVelocity(
    selector: (bodyState: BodyState) => number | undefined,
  ): SignalVelocity | undefined {
    const snapshot = this.snapshot();
    const latest = latestSignalSample(snapshot.validSamples, selector);

    if (!latest) {
      return undefined;
    }

    const previous = [...snapshot.validSamples]
      .reverse()
      .find(
        (sample) =>
          sample.timestampMs < latest.timestampMs && selector(sample.bodyState) !== undefined,
      );

    if (!previous) {
      return undefined;
    }

    const elapsedSeconds = (latest.timestampMs - previous.timestampMs) / 1000;

    if (elapsedSeconds <= 0) {
      return undefined;
    }

    const latestValue = selector(latest.bodyState);
    const previousValue = selector(previous.bodyState);

    if (latestValue === undefined || previousValue === undefined) {
      return undefined;
    }

    const valuePerSecond = (latestValue - previousValue) / elapsedSeconds;

    return {
      valuePerSecond,
      direction: directionForVelocity(valuePerSecond),
      fromTimestampMs: previous.timestampMs,
      toTimestampMs: latest.timestampMs,
    };
  }

  public signalStats(selector: (bodyState: BodyState) => number | undefined): SignalStats {
    const values = this.snapshot()
      .validSamples.map((sample) => selector(sample.bodyState))
      .filter((value): value is number => value !== undefined && Number.isFinite(value));

    if (values.length === 0) {
      return {
        min: 0,
        max: 0,
        average: 0,
        range: 0,
        sampleCount: 0,
      };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
      min,
      max,
      average: average(values),
      range: max - min,
      sampleCount: values.length,
    };
  }

  public signalRhythm(selector: (bodyState: BodyState) => number | undefined): SignalRhythm {
    const samples = this.snapshot()
      .validSamples.map((sample) => ({
        timestampMs: sample.timestampMs,
        value: selector(sample.bodyState),
      }))
      .filter(
        (sample): sample is { readonly timestampMs: number; readonly value: number } =>
          sample.value !== undefined && Number.isFinite(sample.value),
      );

    if (samples.length < 3) {
      return {
        cycleCount: 0,
        amplitude: 0,
        cycleDurationRangeMs: 0,
        tempoDriftRatio: 0,
        rhythmScore: 0,
        sampleCount: samples.length,
      };
    }

    const values = samples.map((sample) => sample.value);
    const amplitude = Math.max(...values) - Math.min(...values);
    const turningPoints = signalTurningPoints(samples);
    const cycleCount = Math.floor(turningPoints.length / 2);
    const cycleDurations = turningPoints
      .slice(2)
      .map((point, index) => point.timestampMs - turningPoints[index]?.timestampMs)
      .filter((duration): duration is number => duration !== undefined && duration > 0);
    const averageCycleMs = cycleDurations.length === 0 ? undefined : average(cycleDurations);
    const cycleDurationRangeMs =
      cycleDurations.length === 0 ? 0 : Math.max(...cycleDurations) - Math.min(...cycleDurations);
    const tempoDriftRatio =
      averageCycleMs === undefined || averageCycleMs <= 0
        ? 0
        : clamp01(cycleDurationRangeMs / averageCycleMs);

    return {
      cycleCount,
      amplitude,
      averageCycleMs,
      cycleDurationRangeMs,
      tempoDriftRatio,
      rhythmScore: clamp01((cycleCount / 2) * clamp01(amplitude / 40)),
      sampleCount: samples.length,
    };
  }

  private addSample(sample: MovementWindowSample): MovementWindowSnapshot {
    this.samples = [...this.samples, sample]
      .filter((candidate) => sample.timestampMs - candidate.timestampMs <= this.maxAgeMs)
      .slice(-this.maxSamples);

    return this.snapshot();
  }
}

function signalTurningPoints(
  samples: readonly { readonly timestampMs: number; readonly value: number }[],
): readonly { readonly timestampMs: number; readonly value: number }[] {
  const points: { readonly timestampMs: number; readonly value: number }[] = [];

  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];

    if (!previous || !current || !next) {
      continue;
    }

    if (
      (current.value >= previous.value && current.value > next.value) ||
      (current.value <= previous.value && current.value < next.value)
    ) {
      points.push(current);
    }
  }

  return points;
}

function latestSignalSample(
  samples: readonly ValidMovementWindowSample[],
  selector: (bodyState: BodyState) => number | undefined,
): ValidMovementWindowSample | undefined {
  return [...samples].reverse().find((sample) => selector(sample.bodyState) !== undefined);
}

function hasBodyState(sample: MovementWindowSample): sample is ValidMovementWindowSample {
  return sample.bodyState !== undefined;
}

function directionForVelocity(valuePerSecond: number): MovementDirection {
  if (Math.abs(valuePerSecond) < 0.001) {
    return 'stable';
  }

  return valuePerSecond > 0 ? 'increasing' : 'decreasing';
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
