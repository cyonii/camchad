import { describe, expect, it } from 'vitest';

import {
  parsePoseTrace,
  PoseTraceRecorder,
  poseFramesFromTrace,
  serializePoseTrace,
} from './pose-trace.js';
import { toLandmarkMap, type PoseFrame } from './landmarks.js';

describe('PoseTraceRecorder', () => {
  it('records pose frames and missing samples without raw video data', () => {
    const recorder = new PoseTraceRecorder({
      source: 'synthetic',
      createdAt: '2026-05-16T12:00:00.000Z',
      notes: 'fixture',
      metadata: {
        sessionId: 'session_1',
        movementLabels: ['push_up'],
        cameraAngle: 'side',
      },
    });

    recorder.addFrame(frame(100));
    recorder.addMissingFrame(140);

    expect(recorder.snapshot()).toEqual({
      schemaVersion: 1,
      createdAt: '2026-05-16T12:00:00.000Z',
      source: 'synthetic',
      notes: 'fixture',
      metadata: {
        sessionId: 'session_1',
        movementLabels: ['push_up'],
        cameraAngle: 'side',
      },
      samples: [
        expect.objectContaining({
          timestampMs: 100,
          landmarks: expect.arrayContaining([
            expect.objectContaining({
              name: 'left_shoulder',
            }),
          ]),
        }),
        {
          timestampMs: 140,
          missing: true,
        },
      ],
    });
  });

  it('round-trips trace JSON back into pose frames', () => {
    const recorder = new PoseTraceRecorder({
      source: 'synthetic',
      createdAt: '2026-05-16T12:00:00.000Z',
    });
    recorder.addFrame(frame(100));
    recorder.addMissingFrame(140);

    const parsed = parsePoseTrace(serializePoseTrace(recorder.snapshot()));
    const frames = poseFramesFromTrace(parsed);

    expect(frames[0]).toMatchObject({
      timestampMs: 100,
      confidence: 0.9,
    });
    expect(frames[0]?.landmarks.get('left_shoulder')).toMatchObject({
      x: 0.3,
      y: 0.4,
    });
    expect(frames[1]).toBeUndefined();
  });
});

function frame(timestampMs: number): PoseFrame {
  return {
    timestampMs,
    confidence: 0.9,
    landmarks: toLandmarkMap([
      {
        name: 'left_shoulder',
        x: 0.3,
        y: 0.4,
        visibility: 0.9,
      },
      {
        name: 'right_shoulder',
        x: 0.4,
        y: 0.4,
        visibility: 0.9,
      },
    ]),
  };
}
