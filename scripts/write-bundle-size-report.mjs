import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const reportPath = join(repoRoot, '.dev', 'reports', 'bundle-size.json');
const apps = [
  { name: 'web', distPath: join(repoRoot, 'apps', 'web', 'dist') },
  { name: 'desktop', distPath: join(repoRoot, 'apps', 'desktop', 'dist') },
];
const measuredExtensions = new Set(['.js', '.css', '.html']);

const report = {
  generatedAt: new Date().toISOString(),
  apps: await Promise.all(apps.map(measureApp)),
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

for (const app of report.apps) {
  const largest = app.assets[0];

  if (!largest) {
    console.log(`${app.name}: no built assets found`);
    continue;
  }

  console.log(
    `${app.name}: ${app.totalBytes} bytes raw, ${app.totalGzipBytes} bytes gzip; largest ${largest.path} (${largest.bytes} raw, ${largest.gzipBytes} gzip)`,
  );
}

console.log(`Wrote ${reportPath}`);

async function measureApp(app) {
  const assets = (await measureDirectory(app.distPath))
    .sort((a, b) => b.bytes - a.bytes)
    .map((asset) => ({
      ...asset,
      path: relative(app.distPath, asset.path),
    }));

  return {
    name: app.name,
    distPath: relative(repoRoot, app.distPath),
    totalBytes: sum(assets.map((asset) => asset.bytes)),
    totalGzipBytes: sum(assets.map((asset) => asset.gzipBytes)),
    assets,
  };
}

async function measureDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const assets = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return measureDirectory(path);
      }

      if (!entry.isFile() || !measuredExtensions.has(extname(entry.name))) {
        return [];
      }

      const [metadata, content] = await Promise.all([stat(path), readFile(path)]);

      return [
        {
          path,
          bytes: metadata.size,
          gzipBytes: gzipSync(content).byteLength,
        },
      ];
    }),
  );

  return assets.flat();
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
