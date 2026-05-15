import type { BodyState } from './body-state.js';
import { MovementWindow, type MovementWindowSnapshot } from './movement-window.js';
import {
  TemporalConfidenceAccumulator,
  type TemporalConfidenceOptions,
  type TemporalConfidenceSnapshot,
} from './temporal-confidence.js';

export interface MovementTemporalTrackerOptions {
  readonly windowMaxAgeMs: number;
  readonly windowMaxSamples?: number;
  readonly confidence: TemporalConfidenceOptions;
}

export interface MovementTemporalTrackerSnapshot {
  readonly window: MovementWindowSnapshot;
  readonly confidence: TemporalConfidenceSnapshot;
}

export class MovementTemporalTracker {
  private readonly window: MovementWindow;
  private readonly confidence: TemporalConfidenceAccumulator;
  private lastTimestampMs?: number;

  public constructor(options: MovementTemporalTrackerOptions) {
    this.window = new MovementWindow({
      maxAgeMs: options.windowMaxAgeMs,
      maxSamples: options.windowMaxSamples,
    });
    this.confidence = new TemporalConfidenceAccumulator(options.confidence);
  }

  public add(bodyState: BodyState, rawConfidence: number): MovementTemporalTrackerSnapshot {
    this.lastTimestampMs = bodyState.timestampMs;

    return {
      window: this.window.add(bodyState),
      confidence: this.confidence.addSample(rawConfidence),
    };
  }

  public addMissing(timestampMs?: number): MovementTemporalTrackerSnapshot {
    this.lastTimestampMs = timestampMs ?? this.nextMissingTimestamp();

    return {
      window: this.window.addMissing(this.lastTimestampMs),
      confidence: this.confidence.addSample(0),
    };
  }

  public signalVelocity(
    selector: Parameters<MovementWindow['signalVelocity']>[0],
  ): ReturnType<MovementWindow['signalVelocity']> {
    return this.window.signalVelocity(selector);
  }

  public reset(): void {
    this.lastTimestampMs = undefined;
    this.window.reset();
    this.confidence.reset();
  }

  private nextMissingTimestamp(): number {
    return (this.lastTimestampMs ?? 0) + 16;
  }
}
