import { toLandmarkMap, type PoseFrame, type PoseLandmark } from './landmarks.js';

export interface PoseTraceFrame {
  readonly timestampMs: number;
  readonly confidence: number;
  readonly landmarks: readonly PoseLandmark[];
  readonly worldLandmarks?: readonly PoseLandmark[];
}

export interface PoseTraceMissingFrame {
  readonly timestampMs: number;
  readonly missing: true;
}

export type PoseTraceSample = PoseTraceFrame | PoseTraceMissingFrame;

export interface PoseTrace {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly source: 'camera' | 'video' | 'synthetic' | 'unknown';
  readonly notes?: string;
  readonly metadata?: PoseTraceMetadata;
  readonly samples: readonly PoseTraceSample[];
}

export interface PoseTraceMetadata {
  readonly sessionId?: string;
  readonly movementLabels?: readonly string[];
  readonly cameraAngle?: string;
  readonly lightingNotes?: string;
  readonly captureNotes?: string;
}

export class PoseTraceRecorder {
  private readonly samples: PoseTraceSample[] = [];

  public constructor(
    private readonly options: {
      readonly source?: PoseTrace['source'];
      readonly notes?: string;
      readonly metadata?: PoseTraceMetadata;
      readonly createdAt?: string;
    } = {},
  ) {}

  public addFrame(frame: PoseFrame): void {
    this.samples.push(poseFrameToTraceFrame(frame));
  }

  public addMissingFrame(timestampMs: number): void {
    this.samples.push({ timestampMs, missing: true });
  }

  public clear(): void {
    this.samples.length = 0;
  }

  public snapshot(): PoseTrace {
    return {
      schemaVersion: 1,
      createdAt: this.options.createdAt ?? new Date().toISOString(),
      source: this.options.source ?? 'unknown',
      notes: this.options.notes,
      metadata: this.options.metadata,
      samples: [...this.samples],
    };
  }
}

export function poseFrameToTraceFrame(frame: PoseFrame): PoseTraceFrame {
  return {
    timestampMs: frame.timestampMs,
    confidence: frame.confidence,
    landmarks: [...frame.landmarks.values()],
    worldLandmarks: frame.worldLandmarks ? [...frame.worldLandmarks.values()] : undefined,
  };
}

export function poseTraceFrameToPoseFrame(frame: PoseTraceFrame): PoseFrame {
  return {
    timestampMs: frame.timestampMs,
    confidence: frame.confidence,
    landmarks: toLandmarkMap(frame.landmarks),
    worldLandmarks: frame.worldLandmarks ? toLandmarkMap(frame.worldLandmarks) : undefined,
  };
}

export function serializePoseTrace(trace: PoseTrace): string {
  return `${JSON.stringify(trace, null, 2)}\n`;
}

export function parsePoseTrace(serializedTrace: string): PoseTrace {
  const trace = JSON.parse(serializedTrace) as PoseTrace;

  if (trace.schemaVersion !== 1 || !Array.isArray(trace.samples)) {
    throw new Error('Unsupported pose trace format.');
  }

  return trace;
}

export function poseFramesFromTrace(trace: PoseTrace): readonly (PoseFrame | undefined)[] {
  return trace.samples.map((sample) =>
    'missing' in sample ? undefined : poseTraceFrameToPoseFrame(sample),
  );
}
