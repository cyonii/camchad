import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { clearTimeout, setTimeout } from 'node:timers';

/* global AbortController */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const wasmSource = join(repoRoot, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const modelCacheRoot = join(repoRoot, '.dev', 'cache', 'mediapipe-models');
const modelDownloadTimeoutMs = 120_000;
const modelDownloadAttempts = 3;
const publicRoots = [
  join(repoRoot, 'apps', 'web', 'public', 'vendor', 'mediapipe'),
  join(repoRoot, 'apps', 'desktop', 'public', 'vendor', 'mediapipe'),
];
const poseModels = [
  {
    filename: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
  {
    filename: 'pose_landmarker_full.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  },
  {
    filename: 'pose_landmarker_heavy.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
  },
];

await Promise.all(poseModels.map((model) => ensureModelCached(model)));

for (const publicRoot of publicRoots) {
  await syncWasmFiles(publicRoot);
  await syncModels(publicRoot);
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

async function syncModels(publicRoot) {
  await Promise.all(poseModels.map((model) => copyCachedModel(publicRoot, model)));
}

async function ensureModelCached(model) {
  const cachedModel = join(modelCacheRoot, model.filename);

  if (await isUsableFile(cachedModel)) {
    return;
  }

  await mkdir(dirname(cachedModel), { recursive: true });
  const existingLocalModel = await findExistingPublicModel(model.filename);

  if (existingLocalModel) {
    await copyFile(existingLocalModel, cachedModel);
    return;
  }

  const temporaryModel = `${cachedModel}.download`;

  for (let attempt = 1; attempt <= modelDownloadAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), modelDownloadTimeoutMs);

    try {
      console.log(`Downloading ${model.filename} (${attempt}/${modelDownloadAttempts})...`);
      const response = await fetch(model.url, { signal: controller.signal });

      if (!response.ok || !response.body) {
        throw new Error(
          `Failed to download MediaPipe pose model: ${response.status} ${response.statusText}`,
        );
      }

      await pipeline(response.body, createWriteStream(temporaryModel));
      await rename(temporaryModel, cachedModel);
      return;
    } catch (error) {
      await rm(temporaryModel, { force: true });

      if (attempt === modelDownloadAttempts) {
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function copyCachedModel(publicRoot, model) {
  const target = join(publicRoot, 'models', model.filename);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(modelCacheRoot, model.filename), target);
}

async function isUsableFile(path) {
  try {
    const metadata = await stat(path);
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
}

async function findExistingPublicModel(filename) {
  for (const publicRoot of publicRoots) {
    const modelPath = join(publicRoot, 'models', filename);

    if (await isUsableFile(modelPath)) {
      return modelPath;
    }
  }

  return null;
}
