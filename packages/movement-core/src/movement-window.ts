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

  private addSample(sample: MovementWindowSample): MovementWindowSnapshot {
    this.samples = [...this.samples, sample]
      .filter((candidate) => sample.timestampMs - candidate.timestampMs <= this.maxAgeMs)
      .slice(-this.maxSamples);

    return this.snapshot();
  }
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
