import type { ExerciseDetector } from './exercise-detector.js';
import {
  defaultPushUpConfig,
  PushUpDetector,
  type PushUpDetectorConfig,
} from './push-up-detector.js';

export interface ExerciseDefinition {
  readonly type: 'push_up';
  readonly label: string;
  readonly defaultCameraAngle: 'side' | 'front_diagonal';
  readonly createDetector: (config?: Partial<PushUpDetectorConfig>) => ExerciseDetector;
}

export const exerciseRegistry: readonly ExerciseDefinition[] = [
  {
    type: 'push_up',
    label: 'Push-ups',
    defaultCameraAngle: 'side',
    createDetector: (config) => new PushUpDetector({ ...defaultPushUpConfig, ...config }),
  },
];
