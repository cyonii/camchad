export interface SignalFilter {
  add(value: number, timestampMs?: number): number;
  reset(): void;
}

export class ExponentialSignalFilter implements SignalFilter {
  private previous?: number;

  public constructor(private readonly alpha = 0.65) {
    validateUnitInterval(alpha, 'alpha');
  }

  public add(value: number): number {
    if (this.previous === undefined) {
      this.previous = value;
      return value;
    }

    const smoothed = this.previous * (1 - this.alpha) + value * this.alpha;
    this.previous = smoothed;
    return smoothed;
  }

  public reset(): void {
    this.previous = undefined;
  }
}

export class MovingMedianSignalFilter implements SignalFilter {
  private readonly windowSize: number;
  private values: number[] = [];

  public constructor(windowSize = 5) {
    if (!Number.isInteger(windowSize) || windowSize <= 0) {
      throw new Error('MovingMedianSignalFilter windowSize must be a positive integer.');
    }

    this.windowSize = windowSize;
  }

  public add(value: number): number {
    this.values = [...this.values, value].slice(-this.windowSize);
    const sorted = [...this.values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 1) {
      return sorted[midpoint] ?? value;
    }

    return ((sorted[midpoint - 1] ?? value) + (sorted[midpoint] ?? value)) / 2;
  }

  public reset(): void {
    this.values = [];
  }
}

export interface OneEuroSignalFilterOptions {
  readonly minCutoff?: number;
  readonly beta?: number;
  readonly derivativeCutoff?: number;
}

export class OneEuroSignalFilter implements SignalFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private previousRaw?: number;
  private previousFiltered?: number;
  private previousDerivative = 0;
  private previousTimestampMs?: number;

  public constructor(options: OneEuroSignalFilterOptions = {}) {
    this.minCutoff = options.minCutoff ?? 1;
    this.beta = options.beta ?? 0;
    this.derivativeCutoff = options.derivativeCutoff ?? 1;

    if (this.minCutoff <= 0 || this.derivativeCutoff <= 0) {
      throw new Error('OneEuroSignalFilter cutoff values must be greater than zero.');
    }

    if (this.beta < 0) {
      throw new Error('OneEuroSignalFilter beta must not be negative.');
    }
  }

  public add(value: number, timestampMs = Date.now()): number {
    if (
      this.previousRaw === undefined ||
      this.previousFiltered === undefined ||
      this.previousTimestampMs === undefined
    ) {
      this.previousRaw = value;
      this.previousFiltered = value;
      this.previousTimestampMs = timestampMs;
      return value;
    }

    const elapsedSeconds = Math.max((timestampMs - this.previousTimestampMs) / 1000, 0.001);
    const derivative = (value - this.previousRaw) / elapsedSeconds;
    const derivativeAlpha = alphaForCutoff(this.derivativeCutoff, elapsedSeconds);
    const filteredDerivative =
      this.previousDerivative * (1 - derivativeAlpha) + derivative * derivativeAlpha;
    const cutoff = this.minCutoff + this.beta * Math.abs(filteredDerivative);
    const valueAlpha = alphaForCutoff(cutoff, elapsedSeconds);
    const filtered = this.previousFiltered * (1 - valueAlpha) + value * valueAlpha;

    this.previousRaw = value;
    this.previousFiltered = filtered;
    this.previousDerivative = filteredDerivative;
    this.previousTimestampMs = timestampMs;

    return filtered;
  }

  public reset(): void {
    this.previousRaw = undefined;
    this.previousFiltered = undefined;
    this.previousDerivative = 0;
    this.previousTimestampMs = undefined;
  }
}

function alphaForCutoff(cutoff: number, elapsedSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / elapsedSeconds);
}

function validateUnitInterval(value: number, name: string): void {
  if (value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1.`);
  }
}
