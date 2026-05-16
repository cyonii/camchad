import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const reportPath = join(repoRoot, '.dev', 'reports', 'perception-evaluation.json');
const packageJson = JSON.parse(
  await readFile(
    join(repoRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json'),
    'utf8',
  ),
);
const publicRoots = {
  web: join(repoRoot, 'apps', 'web', 'public', 'vendor', 'mediapipe'),
  electron: join(repoRoot, 'apps', 'desktop', 'public', 'vendor', 'mediapipe'),
};
const modelFiles = [
  'pose_landmarker_lite.task',
  'pose_landmarker_full.task',
  'pose_landmarker_heavy.task',
];

const report = {
  generatedAt: new Date().toISOString(),
  mediapipeTasksVisionVersion: packageJson.version,
  modelAssets: Object.fromEntries(
    await Promise.all(
      Object.entries(publicRoots).map(async ([runtime, publicRoot]) => [
        runtime,
        Object.fromEntries(
          await Promise.all(
            modelFiles.map(async (filename) => [
              filename,
              await fileExists(join(publicRoot, 'models', filename)),
            ]),
          ),
        ),
      ]),
    ),
  ),
  runtimeMeasurements: {
    status: 'not_recorded_by_this_script',
    reason:
      'CPU, FPS, latency, and downstream movement stability require an actual browser/Electron video runtime with camera or local video frames.',
    requiredNextStep:
      'Run the benchmark harness in web and Electron with the same local video/camera workload and append measured samples to this report.',
  },
  prototypeCapabilities: {
    holistic:
      'Available in @mediapipe/tasks-vision and represented as a disabled prototype capability.',
    handLandmarker:
      'Available in @mediapipe/tasks-vision and represented as a selective disabled prototype capability.',
    faceLandmarker:
      'Available in @mediapipe/tasks-vision and represented as a disabled head-orientation diagnostic prototype.',
    segmentation:
      'Pose segmentation can be enabled through PoseEstimatorOptions; dedicated person segmentation still needs a measured use case.',
    onnxRuntime:
      'Not installed; keep as an evaluated future path until a specific local model justifies the dependency.',
  },
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${reportPath}`);

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
