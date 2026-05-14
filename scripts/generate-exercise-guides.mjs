import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const width = 480;
const height = 270;
const frameCount = 18;
const frameDelay = 7;
const outputDirs = ['apps/web/public/exercise-guides', 'apps/desktop/public/exercise-guides'];

const exercises = [
  ['push-up', 'push_up', sidePushUp],
  ['squat', 'squat', sideSquat],
  ['sit-up', 'sit_up', sitUp],
  ['lunge', 'lunge', lunge],
  ['jumping-jack', 'jumping_jack', jumpingJack],
  ['plank', 'plank', plank],
  ['pull-up', 'pull_up', pullUp],
  ['burpee', 'burpee', burpee],
  ['mountain-climber', 'mountain_climber', mountainClimber],
  ['high-knees', 'high_knees', highKnees],
  ['lateral-raise', 'lateral_raise', lateralRaise],
  ['yoga-hold', 'yoga_hold', yogaHold],
  ['crunch', 'crunch', crunch],
  ['leg-raise', 'leg_raise', legRaise],
  ['glute-bridge', 'glute_bridge', gluteBridge],
  ['wall-sit', 'wall_sit', wallSit],
  ['calf-raise', 'calf_raise', calfRaise],
  ['step-up', 'step_up', stepUp],
  ['tricep-dip', 'tricep_dip', tricepDip],
  ['bicep-curl', 'bicep_curl', bicepCurl],
  ['shoulder-press', 'shoulder_press', shoulderPress],
  ['deadlift', 'deadlift', deadlift],
  ['bear-crawl', 'bear_crawl', bearCrawl],
  ['side-plank', 'side_plank', sidePlank],
  ['bird-dog', 'bird_dog', birdDog],
  ['superman-hold', 'superman_hold', supermanHold],
  ['russian-twist', 'russian_twist', russianTwist],
];

for (const outputDir of outputDirs) {
  await mkdir(outputDir, { recursive: true });
}

for (const [slug, type, poseFactory] of exercises) {
  const tempDir = await mkdtemp(join(tmpdir(), `camchad-${slug}-`));

  try {
    const frames = [];

    for (let frame = 0; frame < frameCount; frame += 1) {
      const t = frame / (frameCount - 1);
      const svgPath = join(tempDir, `${String(frame).padStart(3, '0')}.svg`);
      await writeFile(svgPath, renderFrame(type, poseFactory(t), t), 'utf8');
      frames.push(svgPath);
    }

    const tempGif = join(tempDir, `${slug}-guide.gif`);
    await execFileAsync('magick', [
      '-delay',
      String(frameDelay),
      '-loop',
      '0',
      ...frames,
      '-layers',
      'Optimize',
      tempGif,
    ]);

    for (const outputDir of outputDirs) {
      await copyFile(tempGif, join(outputDir, `${slug}-guide.gif`));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

for (const outputDir of outputDirs) {
  const files = (await readdir(outputDir)).filter((file) => file.endsWith('.gif'));
  console.log(`${outputDir}: ${files.length} guide GIFs`);
}

function renderFrame(type, pose, t) {
  const bones = [
    ['head', 'neck'],
    ['neck', 'shoulderL'],
    ['neck', 'shoulderR'],
    ['shoulderL', 'elbowL'],
    ['elbowL', 'wristL'],
    ['shoulderR', 'elbowR'],
    ['elbowR', 'wristR'],
    ['neck', 'hip'],
    ['hip', 'kneeL'],
    ['kneeL', 'ankleL'],
    ['hip', 'kneeR'],
    ['kneeR', 'ankleR'],
  ];
  const points = Object.entries(pose);
  const path = motionPath(pose);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="45%" r="65%">
      <stop offset="0%" stop-color="#203830"/>
      <stop offset="100%" stop-color="#07100d"/>
    </radialGradient>
    <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.6" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <path d="M0 216 H480 M0 180 H480 M0 144 H480 M0 108 H480 M72 0 V270 M144 0 V270 M216 0 V270 M288 0 V270 M360 0 V270 M432 0 V270" stroke="#7ee88f" stroke-opacity="0.08" stroke-width="1"/>
  <path d="${path}" fill="none" stroke="#7ee88f" stroke-opacity="0.22" stroke-width="2" stroke-dasharray="5 7"/>
  ${bones
    .map(([a, b]) => {
      const start = pose[a];
      const end = pose[b];
      return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#ebdf36" stroke-width="3.2" stroke-linecap="round" filter="url(#softGlow)"/>`;
    })
    .join('\n  ')}
  ${points
    .map(
      ([name, point]) =>
        `<circle cx="${point.x}" cy="${point.y}" r="${name === 'head' ? 8 : 5.4}" fill="#62d879" stroke="#09130f" stroke-width="2"/>`,
    )
    .join('\n  ')}
  <g font-family="SFMono-Regular,Roboto Mono,monospace" text-transform="uppercase">
    <rect x="18" y="18" width="192" height="32" rx="5" fill="#08120f" fill-opacity="0.72" stroke="#7ee88f" stroke-opacity="0.22"/>
    <circle cx="33" cy="34" r="4" fill="#7ee88f"/>
    <text x="45" y="38" fill="#d8eadf" font-size="12" letter-spacing="1">${labelFor(type)}</text>
    <text x="365" y="38" fill="#9eb5ab" font-size="10" letter-spacing="1">${Math.round(t * 100)
      .toString()
      .padStart(2, '0')}%</text>
  </g>
</svg>`;
}

function motionPath(pose) {
  const primary = [pose.head, pose.neck, pose.hip, pose.kneeL, pose.ankleL]
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
  return `M ${primary.replaceAll(' ', ' L ')}`;
}

function labelFor(type) {
  return type
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function wave(t) {
  return (1 - Math.cos(t * Math.PI * 2)) / 2;
}

function point(x, y) {
  return { x, y };
}

function standingBase(x, y, scale = 1) {
  return {
    head: point(x, y - 62 * scale),
    neck: point(x, y - 43 * scale),
    shoulderL: point(x - 24 * scale, y - 38 * scale),
    shoulderR: point(x + 24 * scale, y - 38 * scale),
    elbowL: point(x - 34 * scale, y - 4 * scale),
    elbowR: point(x + 34 * scale, y - 4 * scale),
    wristL: point(x - 36 * scale, y + 30 * scale),
    wristR: point(x + 36 * scale, y + 30 * scale),
    hip: point(x, y + 10 * scale),
    kneeL: point(x - 18 * scale, y + 62 * scale),
    kneeR: point(x + 18 * scale, y + 62 * scale),
    ankleL: point(x - 20 * scale, y + 106 * scale),
    ankleR: point(x + 20 * scale, y + 106 * scale),
  };
}

function sidePushUp(t) {
  const d = wave(t);
  const y = 150 + 34 * d;
  return {
    head: point(128, y - 36),
    neck: point(162, y - 22),
    shoulderL: point(162, y - 22),
    shoulderR: point(162, y - 22),
    elbowL: point(176, y + 20 + 12 * d),
    elbowR: point(176, y + 20 + 12 * d),
    wristL: point(174, 218),
    wristR: point(174, 218),
    hip: point(285, y - 6),
    kneeL: point(362, y + 16),
    kneeR: point(362, y + 16),
    ankleL: point(424, y + 36),
    ankleR: point(424, y + 36),
  };
}

function sideSquat(t) {
  const d = wave(t);
  return {
    ...standingBase(245, 100 + 52 * d, 0.78),
    hip: point(245 - 12 * d, 108 + 52 * d),
    kneeL: point(220, 162 + 36 * d),
    kneeR: point(282, 162 + 36 * d),
    ankleL: point(184, 226),
    ankleR: point(320, 226),
  };
}

function sitUp(t) {
  const d = wave(t);
  return {
    head: point(188 - 34 * d, 190 - 72 * d),
    neck: point(216 - 28 * d, 190 - 58 * d),
    shoulderL: point(216 - 28 * d, 190 - 58 * d),
    shoulderR: point(216 - 28 * d, 190 - 58 * d),
    elbowL: point(194 - 28 * d, 206 - 50 * d),
    elbowR: point(232 - 28 * d, 206 - 50 * d),
    wristL: point(177 - 28 * d, 218 - 42 * d),
    wristR: point(250 - 28 * d, 218 - 42 * d),
    hip: point(292, 206),
    kneeL: point(350, 178),
    kneeR: point(350, 178),
    ankleL: point(405, 222),
    ankleR: point(405, 222),
  };
}

function lunge(t) {
  const d = wave(t);
  const p = standingBase(245, 95 + 32 * d, 0.76);
  return {
    ...p,
    hip: point(245, 108 + 38 * d),
    kneeL: point(184, 160 + 36 * d),
    ankleL: point(132, 224),
    kneeR: point(300, 172 + 12 * d),
    ankleR: point(365, 224),
  };
}

function jumpingJack(t) {
  const d = wave(t);
  const p = standingBase(240, 98, 0.78);
  return {
    ...p,
    elbowL: point(216 - 44 * d, 96 - 70 * d),
    elbowR: point(264 + 44 * d, 96 - 70 * d),
    wristL: point(210 - 76 * d, 128 - 92 * d),
    wristR: point(270 + 76 * d, 128 - 92 * d),
    kneeL: point(222 - 26 * d, 160 + 12 * d),
    kneeR: point(258 + 26 * d, 160 + 12 * d),
    ankleL: point(220 - 66 * d, 226),
    ankleR: point(260 + 66 * d, 226),
  };
}

function plank() {
  return sidePushUp(0);
}

function pullUp(t) {
  const d = wave(t);
  const p = standingBase(240, 122 - 46 * d, 0.76);
  return {
    ...p,
    elbowL: point(212, 78 - 22 * d),
    elbowR: point(268, 78 - 22 * d),
    wristL: point(190, 34),
    wristR: point(290, 34),
    ankleL: point(222, 232 - 46 * d),
    ankleR: point(258, 232 - 46 * d),
  };
}

function burpee(t) {
  return t < 0.5 ? sidePushUp(t * 2) : jumpingJack((t - 0.5) * 2);
}

function mountainClimber(t) {
  const d = wave(t);
  const p = sidePushUp(0);
  return {
    ...p,
    kneeL: point(330 - 74 * d, 178 + 18 * d),
    ankleL: point(412 - 116 * d, 192 + 32 * d),
  };
}

function highKnees(t) {
  const d = wave(t);
  const p = standingBase(240, 100, 0.78);
  return {
    ...p,
    kneeL: point(218, 168 - 62 * d),
    ankleL: point(214, 226 - 28 * d),
    elbowL: point(205, 95 + 24 * d),
    elbowR: point(272, 124 - 22 * d),
  };
}

function lateralRaise(t) {
  const d = wave(t);
  const p = standingBase(240, 100, 0.78);
  return {
    ...p,
    elbowL: point(216 - 42 * d, 96 - 34 * d),
    elbowR: point(264 + 42 * d, 96 - 34 * d),
    wristL: point(214 - 82 * d, 126 - 50 * d),
    wristR: point(266 + 82 * d, 126 - 50 * d),
  };
}

function yogaHold() {
  const p = standingBase(240, 100, 0.74);
  return {
    ...p,
    wristL: point(185, 58),
    wristR: point(295, 58),
    ankleL: point(214, 226),
    kneeR: point(292, 132),
    ankleR: point(350, 158),
  };
}

function crunch(t) {
  const p = sitUp(t);
  return { ...p, hip: point(298, 210), kneeL: point(350, 186), kneeR: point(350, 186) };
}

function legRaise(t) {
  const d = wave(t);
  return {
    head: point(116, 200),
    neck: point(152, 202),
    shoulderL: point(152, 202),
    shoulderR: point(152, 202),
    elbowL: point(172, 216),
    elbowR: point(172, 216),
    wristL: point(198, 224),
    wristR: point(198, 224),
    hip: point(260, 210),
    kneeL: point(330, 208 - 86 * d),
    kneeR: point(330, 208 - 86 * d),
    ankleL: point(405, 208 - 120 * d),
    ankleR: point(405, 208 - 120 * d),
  };
}

function gluteBridge(t) {
  const d = wave(t);
  return {
    head: point(118, 214),
    neck: point(158, 214),
    shoulderL: point(158, 214),
    shoulderR: point(158, 214),
    elbowL: point(184, 224),
    elbowR: point(184, 224),
    wristL: point(216, 228),
    wristR: point(216, 228),
    hip: point(270, 214 - 72 * d),
    kneeL: point(340, 176),
    kneeR: point(340, 176),
    ankleL: point(398, 224),
    ankleR: point(398, 224),
  };
}

function wallSit() {
  return {
    ...standingBase(240, 140, 0.72),
    neck: point(220, 82),
    hip: point(244, 146),
    kneeL: point(314, 172),
    kneeR: point(314, 172),
    ankleL: point(315, 226),
    ankleR: point(315, 226),
  };
}

function calfRaise(t) {
  const d = wave(t);
  const p = standingBase(240, 100 - 18 * d, 0.78);
  return { ...p, ankleL: point(220, 226 - 18 * d), ankleR: point(260, 226 - 18 * d) };
}

function stepUp(t) {
  const d = wave(t);
  const p = standingBase(230, 112 - 36 * d, 0.74);
  return {
    ...p,
    kneeL: point(284, 165 - 52 * d),
    ankleL: point(340, 226 - 48 * d),
    kneeR: point(214, 172),
    ankleR: point(194, 226),
  };
}

function tricepDip(t) {
  const d = wave(t);
  return {
    head: point(150, 128 + 36 * d),
    neck: point(186, 142 + 36 * d),
    shoulderL: point(186, 142 + 36 * d),
    shoulderR: point(186, 142 + 36 * d),
    elbowL: point(204, 186),
    elbowR: point(204, 186),
    wristL: point(205, 218),
    wristR: point(205, 218),
    hip: point(270, 172 + 22 * d),
    kneeL: point(340, 188),
    kneeR: point(340, 188),
    ankleL: point(410, 224),
    ankleR: point(410, 224),
  };
}

function bicepCurl(t) {
  const d = wave(t);
  const p = standingBase(240, 100, 0.78);
  return {
    ...p,
    elbowL: point(213, 118),
    elbowR: point(267, 118),
    wristL: point(205, 150 - 52 * d),
    wristR: point(275, 150 - 52 * d),
  };
}

function shoulderPress(t) {
  const d = wave(t);
  const p = standingBase(240, 100, 0.78);
  return {
    ...p,
    elbowL: point(212, 100 - 42 * d),
    elbowR: point(268, 100 - 42 * d),
    wristL: point(202, 84 - 80 * d),
    wristR: point(278, 84 - 80 * d),
  };
}

function deadlift(t) {
  const d = wave(t);
  const p = standingBase(245, 102 + 20 * d, 0.76);
  return {
    ...p,
    head: point(226, 52 + 48 * d),
    neck: point(242, 72 + 54 * d),
    shoulderL: point(220, 74 + 54 * d),
    shoulderR: point(262, 74 + 54 * d),
    wristL: point(210, 160 + 48 * d),
    wristR: point(278, 160 + 48 * d),
    hip: point(250, 120 + 32 * d),
  };
}

function bearCrawl(t) {
  const d = wave(t);
  return {
    ...sidePushUp(0),
    hip: point(290, 154),
    kneeL: point(342 - 34 * d, 194),
    ankleL: point(398 - 28 * d, 224),
    wristR: point(170 + 30 * d, 218),
  };
}

function sidePlank() {
  const p = sidePushUp(0);
  return { ...p, elbowL: point(172, 216), wristL: point(172, 216), wristR: point(172, 216) };
}

function birdDog(t) {
  const d = wave(t);
  return {
    ...sidePushUp(0),
    wristL: point(138 - 40 * d, 190 - 36 * d),
    ankleR: point(410 + 22 * d, 182 - 30 * d),
    hip: point(284, 158),
  };
}

function supermanHold() {
  return {
    head: point(130, 168),
    neck: point(170, 178),
    shoulderL: point(170, 178),
    shoulderR: point(170, 178),
    elbowL: point(128, 136),
    elbowR: point(128, 136),
    wristL: point(95, 105),
    wristR: point(95, 105),
    hip: point(272, 190),
    kneeL: point(348, 174),
    kneeR: point(348, 174),
    ankleL: point(414, 148),
    ankleR: point(414, 148),
  };
}

function russianTwist(t) {
  const d = Math.sin(t * Math.PI * 2);
  return {
    ...sitUp(0.55),
    wristL: point(206 + 58 * d, 154),
    wristR: point(228 + 58 * d, 154),
    elbowL: point(196 + 36 * d, 166),
    elbowR: point(238 + 36 * d, 166),
  };
}
