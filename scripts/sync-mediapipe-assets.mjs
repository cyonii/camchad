import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const wasmSource = join(repoRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const publicRoots = [
  join(repoRoot, 'apps', 'web', 'public', 'vendor', 'mediapipe'),
  join(repoRoot, 'apps', 'desktop', 'public', 'vendor', 'mediapipe'),
];
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

for (const publicRoot of publicRoots) {
  await syncWasmFiles(publicRoot);
  await syncModel(publicRoot);
}

console.log('MediaPipe assets synced.');

async function syncWasmFiles(publicRoot) {
  const target = join(publicRoot, 'wasm');
  await mkdir(target, { recursive: true });
  const wasmFiles = await readdir(wasmSource);

  await Promise.all(
    wasmFiles
      .filter((file) => file.endsWith('.wasm') || file.endsWith('.js') || file.endsWith('.data'))
      .map((file) => copyFile(join(wasmSource, file), join(target, file))),
  );
}

async function syncModel(publicRoot) {
  const target = join(publicRoot, 'models', 'pose_landmarker_lite.task');
  await mkdir(dirname(target), { recursive: true });

  const response = await fetch(modelUrl);

  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download MediaPipe pose model: ${response.status} ${response.statusText}`,
    );
  }

  await pipeline(response.body, createWriteStream(target));
}
