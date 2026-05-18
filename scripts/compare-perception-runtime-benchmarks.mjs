import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const defaultReportDirs = [
  join(repoRoot, '.dev', 'reports'),
  join(repoRoot, '.dev', 'benchmarks', 'reports'),
];
const outputPath = join(
  repoRoot,
  '.dev',
  'reports',
  'perception-runtime-benchmark-comparison.json',
);
const inputPaths = process.argv.slice(2).map((path) => resolve(process.cwd(), path));
const reportPaths = inputPaths.length > 0 ? inputPaths : await discoverReports();

if (reportPaths.length < 2) {
  console.error(
    'Need at least two perception runtime benchmark reports. Pass report paths or place perception-runtime-benchmark*.json files under .dev/reports.',
  );
  process.exitCode = 1;
} else {
  const reports = await Promise.all(reportPaths.map(readReport));
  const summaries = reports.flatMap((report) =>
    report.summaries.map((summary) => ({
      ...summary,
      source: relative(repoRoot, report.path),
      score: scoreSummary(summary),
    })),
  );

  if (summaries.length === 0) {
    console.error('No benchmark summaries found in the provided reports.');
    process.exitCode = 1;
  } else {
    const recommendations = summarizeRecommendations(summaries);
    const comparison = {
      generatedAt: new Date().toISOString(),
      inputReports: reports.map((report) => relative(repoRoot, report.path)),
      recommendations,
      summaries: summaries.sort((a, b) => b.score - a.score),
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`);
    printRecommendations(recommendations);
    console.log(`Wrote ${relative(repoRoot, outputPath)}`);
  }
}

async function discoverReports() {
  const discovered = await Promise.all(
    defaultReportDirs.map(async (directory) => {
      try {
        const entries = await readdir(directory, { withFileTypes: true });

        return entries
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.startsWith('perception-runtime-benchmark') &&
              entry.name.endsWith('.json') &&
              !entry.name.includes('comparison'),
          )
          .map((entry) => join(directory, entry.name));
      } catch {
        return [];
      }
    }),
  );

  return discovered.flat().sort();
}

async function readReport(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const summaries = Array.isArray(parsed.summaries) ? parsed.summaries : [];

  return {
    path,
    summaries: summaries.filter(isBenchmarkSummary),
  };
}

function isBenchmarkSummary(value) {
  return (
    value &&
    typeof value.modelQuality === 'string' &&
    typeof value.delegate === 'string' &&
    typeof value.runtime === 'string' &&
    typeof value.sampleCount === 'number' &&
    typeof value.detectedFrameRatio === 'number' &&
    typeof value.averageLatencyMs === 'number' &&
    typeof value.p95LatencyMs === 'number' &&
    typeof value.estimatedFps === 'number' &&
    typeof value.droppedFrameRatio === 'number'
  );
}

function scoreSummary(summary) {
  const latencyScore = clamp01(1 - summary.p95LatencyMs / 80);
  const fpsScore = clamp01(summary.estimatedFps / 30);
  const detectionScore = clamp01(summary.detectedFrameRatio);
  const droppedFrameScore = clamp01(1 - summary.droppedFrameRatio);

  return round4(
    detectionScore * 0.38 + latencyScore * 0.27 + fpsScore * 0.22 + droppedFrameScore * 0.13,
  );
}

function summarizeRecommendations(summaries) {
  const groups = new Map();

  for (const summary of summaries) {
    const key = `${summary.runtime}:${summary.delegate}`;
    const group = groups.get(key) ?? [];
    group.push(summary);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const [runtime, delegate] = key.split(':');
    const ranked = [...group].sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const runnerUp = ranked[1];

    return {
      runtime,
      delegate,
      recommendedModelQuality: best?.modelQuality,
      confidence:
        best && runnerUp ? recommendationConfidence(best.score - runnerUp.score) : 'insufficient',
      reason: best ? reasonFor(best, runnerUp) : 'No valid benchmark summary found.',
      rankedModels: ranked.map((summary) => ({
        modelQuality: summary.modelQuality,
        score: summary.score,
        detectedFrameRatio: round4(summary.detectedFrameRatio),
        averageLatencyMs: round2(summary.averageLatencyMs),
        p95LatencyMs: round2(summary.p95LatencyMs),
        estimatedFps: round2(summary.estimatedFps),
        droppedFrameRatio: round4(summary.droppedFrameRatio),
        source: summary.source,
      })),
    };
  });
}

function recommendationConfidence(scoreGap) {
  if (scoreGap >= 0.12) {
    return 'high';
  }

  if (scoreGap >= 0.05) {
    return 'medium';
  }

  return 'low';
}

function reasonFor(best, runnerUp) {
  const latency = `${round2(best.p95LatencyMs)}ms p95`;
  const fps = `${round2(best.estimatedFps)} FPS`;
  const detection = `${Math.round(best.detectedFrameRatio * 100)}% detection`;

  if (!runnerUp) {
    return `${best.modelQuality} is the only measured model for this runtime/delegate (${latency}, ${fps}, ${detection}).`;
  }

  return `${best.modelQuality} scored ${round4(best.score - runnerUp.score)} above ${runnerUp.modelQuality} with ${latency}, ${fps}, and ${detection}.`;
}

function printRecommendations(recommendations) {
  for (const recommendation of recommendations) {
    console.log(
      `${recommendation.runtime}/${recommendation.delegate}: ${recommendation.recommendedModelQuality} (${recommendation.confidence}) - ${recommendation.reason}`,
    );
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
