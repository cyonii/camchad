import {
  Activity,
  Bell,
  Camera,
  CheckCircle2,
  CircleAlert,
  Dumbbell,
  History,
  Pause,
  Play,
  Settings,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import type { CameraAngle, ExerciseDetectorState, RepEvent } from '@home-workout/exercise-core';
import { defaultPushUpConfig, PushUpDetector } from '@home-workout/exercise-core';
import {
  ExponentialPoseSmoother,
  MediaPipePoseEstimator,
  type LandmarkName,
  type PoseEstimator,
  type PoseFrame,
} from '@home-workout/pose-core';
import type { ExerciseSet, WorkoutSession, WorkoutSummary } from '@home-workout/workout-history';

import type { WorkoutPlatform } from './platform.js';
import { buildHistoryChartModel, type HistoryChartModel } from './history-chart.js';

type View = 'workout' | 'history' | 'settings';

export interface WorkoutAssets {
  readonly modelAssetPath: string;
  readonly wasmAssetPath: string;
}

export interface WorkoutAppProps {
  readonly assets: WorkoutAssets;
  readonly platform: WorkoutPlatform;
}

const initialDetectorState: ExerciseDetectorState = {
  exerciseType: 'push_up',
  phase: 'setup_needed',
  reps: 0,
  validReps: 0,
  partialReps: 0,
  warnings: [],
  metrics: {},
};

export function WorkoutApp({ assets, platform }: WorkoutAppProps): ReactElement {
  const [view, setView] = useState<View>('workout');
  const [sessions, setSessions] = useState<readonly WorkoutSession[]>([]);
  const [summary, setSummary] = useState<WorkoutSummary>({
    totalSessions: 0,
    totalReps: 0,
    validReps: 0,
    partialReps: 0,
  });
  const [startupEnabled, setStartupEnabled] = useState(false);

  const loadHistory = useCallback(async () => {
    const [nextSessions, nextSummary] = await Promise.all([
      platform.history.list(),
      platform.history.summary(),
    ]);
    setSessions(nextSessions);
    setSummary(nextSummary);
  }, [platform.history]);

  useEffect(() => {
    void loadHistory();
    void platform.settings?.getStartupEnabled().then(setStartupEnabled);
  }, [loadHistory, platform.settings]);

  const saveSession = useCallback(
    async (session: WorkoutSession) => {
      await platform.history.save(session);
      await loadHistory();
    },
    [loadHistory, platform.history],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Dumbbell aria-hidden="true" size={22} />
          </div>
          <div>
            <strong>Home Workout</strong>
            <span>Local tracker</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <NavButton
            icon={<Activity size={18} />}
            active={view === 'workout'}
            onClick={() => setView('workout')}
          >
            Workout
          </NavButton>
          <NavButton
            icon={<History size={18} />}
            active={view === 'history'}
            onClick={() => setView('history')}
          >
            Log
          </NavButton>
          <NavButton
            icon={<Settings size={18} />}
            active={view === 'settings'}
            onClick={() => setView('settings')}
          >
            Settings
          </NavButton>
        </nav>

        <div className="sidebar-summary">
          <span>Total reps</span>
          <strong>{summary.totalReps}</strong>
          <small>{summary.totalSessions} saved sessions</small>
        </div>
      </aside>

      <main className="main-content">
        {view === 'workout' ? (
          <WorkoutView assets={assets} platform={platform} onSessionSaved={saveSession} />
        ) : null}
        {view === 'history' ? <HistoryView sessions={sessions} summary={summary} /> : null}
        {view === 'settings' ? (
          <SettingsView
            platform={platform}
            startupEnabled={startupEnabled}
            onStartupEnabledChange={setStartupEnabled}
          />
        ) : null}
      </main>
    </div>
  );
}

function WorkoutView({
  assets,
  platform,
  onSessionSaved,
}: {
  readonly assets: WorkoutAssets;
  readonly platform: WorkoutPlatform;
  readonly onSessionSaved: (session: WorkoutSession) => Promise<void>;
}): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const estimatorRef = useRef<PoseEstimator | null>(null);
  const smootherRef = useRef(new ExponentialPoseSmoother());
  const detectorRef = useRef(new PushUpDetector());
  const animationFrameRef = useRef<number | undefined>(undefined);
  const sessionRef = useRef<WorkoutSession | undefined>(undefined);
  const repEventsRef = useRef<RepEvent[]>([]);
  const seenRepNumbersRef = useRef(new Set<number>());
  const startTokenRef = useRef(0);
  const startInFlightRef = useRef(false);
  const detectorStateRef = useRef<ExerciseDetectorState>(initialDetectorState);

  const [cameraAngle, setCameraAngle] = useState<CameraAngle>('side');
  const [isStarting, setIsStarting] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [detectorState, setDetectorState] = useState<ExerciseDetectorState>(initialDetectorState);
  const [cameraError, setCameraError] = useState<string | undefined>();

  useEffect(() => {
    detectorStateRef.current = detectorState;
  }, [detectorState]);

  const processFrame = useCallback((timestampMs: number): void => {
    const video = videoRef.current;
    const estimator = estimatorRef.current;

    if (!video || !estimator || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    let poseFrame: PoseFrame | undefined;

    try {
      poseFrame = estimator.estimate(video, timestampMs);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Pose estimation failed.');
      poseFrame = undefined;
    }

    const smoothed = poseFrame ? smootherRef.current.smooth(poseFrame) : undefined;
    const nextState = detectorRef.current.processPose(smoothed);
    detectorStateRef.current = nextState;
    setDetectorState(nextState);

    if (nextState.lastRep && !seenRepNumbersRef.current.has(nextState.lastRep.repNumber)) {
      seenRepNumbersRef.current.add(nextState.lastRep.repNumber);
      repEventsRef.current.push(nextState.lastRep);
    }

    drawOverlay(canvasRef.current, video, smoothed);
    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, []);

  const startWorkout = useCallback(async () => {
    if (startInFlightRef.current || isTracking) {
      return;
    }

    const startToken = startTokenRef.current + 1;
    startTokenRef.current = startToken;
    startInFlightRef.current = true;
    setIsStarting(true);
    setIsPreviewActive(false);
    setCameraError(undefined);
    setStatus('Checking camera permission');

    try {
      const permission = await platform.cameraPermission?.ensureCameraPermission();

      if (permission && !permission.granted) {
        throw new Error(permission.reason ?? 'Camera permission was not granted.');
      }

      setStatus('Requesting camera');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      const video = videoRef.current;

      if (!video) {
        stopMediaStream(stream);
        throw new Error('Video element is not available.');
      }

      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      setIsPreviewActive(true);
      setStatus('Starting camera preview');

      await withTimeout(
        video.play(),
        5000,
        'Camera stream opened, but playback did not start. Stop tracking and try again.',
      );
      await waitForVideoFrame(video);

      if (startTokenRef.current !== startToken) {
        stopMediaStream(stream);
        return;
      }

      setStatus('Starting pose engine');
      detectorRef.current = new PushUpDetector({
        ...defaultPushUpConfig,
        cameraAngle,
      });
      smootherRef.current.reset();
      repEventsRef.current = [];
      seenRepNumbersRef.current = new Set();
      sessionRef.current = createSession();

      const estimator = new MediaPipePoseEstimator({
        modelAssetPath: assets.modelAssetPath,
        wasmAssetPath: assets.wasmAssetPath,
        delegate: 'CPU',
      });
      await withTimeout(
        estimator.initialize(),
        15000,
        'Pose engine did not finish starting within 15 seconds. Check that MediaPipe assets are synced and restart tracking.',
      );

      if (startTokenRef.current !== startToken) {
        void estimator.dispose();
        return;
      }

      estimatorRef.current = estimator;
      setIsTracking(true);
      setStatus('Tracking');
      animationFrameRef.current = requestAnimationFrame(processFrame);
    } catch (error) {
      if (startTokenRef.current !== startToken) {
        return;
      }

      stopCamera(videoRef.current);
      setIsPreviewActive(false);
      const message = error instanceof Error ? error.message : 'Unable to start camera tracking.';
      setCameraError(message);
      setStatus('Setup needed');
    } finally {
      if (startTokenRef.current === startToken) {
        startInFlightRef.current = false;
        setIsStarting(false);
      }
    }
  }, [
    assets.modelAssetPath,
    assets.wasmAssetPath,
    cameraAngle,
    isTracking,
    platform.cameraPermission,
    processFrame,
  ]);

  const stopWorkout = useCallback(async () => {
    startTokenRef.current += 1;
    startInFlightRef.current = false;
    setIsStarting(false);
    setIsPreviewActive(false);
    setIsTracking(false);

    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    void estimatorRef.current?.dispose();
    estimatorRef.current = null;
    stopCamera(videoRef.current);
    clearCanvas(canvasRef.current);

    const activeSession = sessionRef.current;

    if (activeSession) {
      const endedAt = new Date();
      const durationSeconds = Math.max(
        0,
        Math.round((endedAt.getTime() - new Date(activeSession.startedAt).getTime()) / 1000),
      );
      const exerciseSet = createExerciseSet(
        activeSession.startedAt,
        endedAt.toISOString(),
        cameraAngle,
        detectorStateRef.current,
        [...repEventsRef.current],
      );
      const completedSession: WorkoutSession = {
        ...activeSession,
        endedAt: endedAt.toISOString(),
        durationSeconds,
        exercises: [exerciseSet],
      };

      if (exerciseSet.reps > 0 || durationSeconds > 3) {
        await onSessionSaved(completedSession);
      }
    }

    sessionRef.current = undefined;
    detectorStateRef.current = initialDetectorState;
    setDetectorState(initialDetectorState);
    setStatus('Ready');
  }, [cameraAngle, onSessionSaved]);

  return (
    <section className="workout-layout">
      <div className="video-panel">
        <div className="video-stage">
          <video ref={videoRef} muted playsInline autoPlay />
          <canvas ref={canvasRef} />
          {!isPreviewActive ? (
            <div className="video-placeholder">
              <Camera size={34} aria-hidden="true" />
              <span>Camera preview appears here</span>
            </div>
          ) : null}
        </div>

        {cameraError ? (
          <div className="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{cameraError}</span>
          </div>
        ) : null}
      </div>

      <div className="workout-panel">
        <div className="panel-heading">
          <span>Push-ups</span>
          <strong>{status}</strong>
        </div>

        <div className="rep-counter">
          <span>Reps</span>
          <strong>{detectorState.validReps}</strong>
          <small>{detectorState.partialReps} partial</small>
        </div>

        <div className="metric-grid">
          <Metric label="Phase" value={formatPhase(detectorState.phase)} />
          <Metric label="Elbow" value={formatMetric(detectorState.metrics.elbowAngle, 'deg')} />
          <Metric
            label="Alignment"
            value={formatMetric(detectorState.metrics.alignmentScore, '%')}
          />
          <Metric
            label="Confidence"
            value={detectorState.phase === 'tracking_lost' ? 'Lost' : 'Live'}
          />
        </div>

        <fieldset className="segmented-control">
          <legend>Camera angle</legend>
          <button
            type="button"
            className={cameraAngle === 'side' ? 'active' : undefined}
            onClick={() => setCameraAngle('side')}
            disabled={isStarting || isTracking}
          >
            Side
          </button>
          <button
            type="button"
            className={cameraAngle === 'front_diagonal' ? 'active' : undefined}
            onClick={() => setCameraAngle('front_diagonal')}
            disabled={isStarting || isTracking}
          >
            Diagonal
          </button>
        </fieldset>

        <div className="form-feedback">
          <span>Form</span>
          {detectorState.warnings.length === 0 ? (
            <p>
              <CheckCircle2 size={18} aria-hidden="true" />
              Tracking conditions look usable.
            </p>
          ) : (
            detectorState.warnings.map((warning) => (
              <p key={warning.code}>
                <CircleAlert size={18} aria-hidden="true" />
                {warning.message}
              </p>
            ))
          )}
        </div>

        <div className="control-row">
          {!isTracking && !isStarting ? (
            <button className="primary-action" type="button" onClick={() => void startWorkout()}>
              <Play size={18} aria-hidden="true" />
              Start
            </button>
          ) : (
            <>
              <button className="secondary-action" type="button" disabled>
                <Pause size={18} aria-hidden="true" />
                {isStarting ? 'Starting' : 'Pause'}
              </button>
              <button className="danger-action" type="button" onClick={() => void stopWorkout()}>
                <Square size={18} aria-hidden="true" />
                Stop
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function HistoryView({
  sessions,
  summary,
}: {
  readonly sessions: readonly WorkoutSession[];
  readonly summary: WorkoutSummary;
}): ReactElement {
  const chartModel = buildHistoryChartModel(sessions);

  return (
    <section className="stack">
      <div className="page-heading">
        <div>
          <span>Exercise log</span>
          <h1>Workout history</h1>
        </div>
        <div className="summary-strip">
          <Metric label="Sessions" value={String(summary.totalSessions)} />
          <Metric label="Valid reps" value={String(summary.validReps)} />
          <Metric label="Partial" value={String(summary.partialReps)} />
        </div>
      </div>

      <WorkoutLogChart model={chartModel} />

      <div className="history-list">
        {sessions.length === 0 ? (
          <div className="empty-state">No saved workouts yet.</div>
        ) : (
          sessions.map((session) => {
            const exercise = session.exercises[0];

            return (
              <article className="history-item" key={session.id}>
                <div>
                  <strong>{formatDate(session.startedAt)}</strong>
                  <span>{exercise ? `${exercise.validReps} push-ups` : 'No exercise set'}</span>
                </div>
                <div>
                  <span>{session.durationSeconds ?? 0}s</span>
                  <small>{exercise?.formWarnings.length ?? 0} warnings</small>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function WorkoutLogChart({ model }: { readonly model: HistoryChartModel }): ReactElement {
  const chartWidth = 720;
  const chartHeight = 240;
  const padding = { top: 24, right: 28, bottom: 44, left: 44 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const gap = 12;
  const barWidth =
    model.points.length === 0
      ? 0
      : Math.max(
          18,
          (plotWidth - gap * Math.max(0, model.points.length - 1)) / model.points.length,
        );

  return (
    <section className="chart-panel" aria-labelledby="workout-chart-title">
      <div className="chart-heading">
        <div>
          <span>Progress</span>
          <h2 id="workout-chart-title">Reps by workout</h2>
        </div>
        <div className="chart-legend" aria-label="Chart legend">
          <span>
            <i className="legend-valid" />
            Valid
          </span>
          <span>
            <i className="legend-partial" />
            Partial
          </span>
        </div>
      </div>

      {model.points.length === 0 ? (
        <div className="chart-empty">Complete a workout to see rep trends.</div>
      ) : (
        <svg className="rep-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img">
          <title>Valid and partial push-up reps by workout</title>
          <line
            className="chart-axis"
            x1={padding.left}
            y1={padding.top + plotHeight}
            x2={chartWidth - padding.right}
            y2={padding.top + plotHeight}
          />
          <line
            className="chart-axis"
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={padding.top + plotHeight}
          />
          <text className="chart-scale" x={padding.left - 10} y={padding.top + 5} textAnchor="end">
            {model.maxReps}
          </text>
          <text
            className="chart-scale"
            x={padding.left - 10}
            y={padding.top + plotHeight + 4}
            textAnchor="end"
          >
            0
          </text>

          {model.points.map((point, index) => {
            const x = padding.left + index * (barWidth + gap);
            const validHeight = (point.validReps / model.maxReps) * plotHeight;
            const partialHeight = (point.partialReps / model.maxReps) * plotHeight;
            const validY = padding.top + plotHeight - validHeight;
            const partialY = validY - partialHeight;

            return (
              <g key={point.sessionId}>
                <title>
                  {`${point.label}: ${point.validReps} valid, ${point.partialReps} partial reps`}
                </title>
                <rect
                  className="bar-valid"
                  x={x}
                  y={validY}
                  width={barWidth}
                  height={Math.max(0, validHeight)}
                  rx="4"
                />
                {point.partialReps > 0 ? (
                  <rect
                    className="bar-partial"
                    x={x}
                    y={partialY}
                    width={barWidth}
                    height={Math.max(0, partialHeight)}
                    rx="4"
                  />
                ) : null}
                <text
                  className="bar-value"
                  x={x + barWidth / 2}
                  y={Math.max(14, partialY - 6)}
                  textAnchor="middle"
                >
                  {point.totalReps}
                </text>
                <text
                  className="chart-label"
                  x={x + barWidth / 2}
                  y={chartHeight - 16}
                  textAnchor="middle"
                >
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}

function SettingsView({
  platform,
  startupEnabled,
  onStartupEnabledChange,
}: {
  readonly platform: WorkoutPlatform;
  readonly startupEnabled: boolean;
  readonly onStartupEnabledChange: (enabled: boolean) => void;
}): ReactElement {
  const [reminderStatus, setReminderStatus] = useState('No reminder sent this session.');
  const canUseStartup = Boolean(platform.settings);
  const canUseNotifications = Boolean(platform.notifications);

  const toggleStartup = async (enabled: boolean) => {
    await platform.settings?.setStartupEnabled(enabled);
    onStartupEnabledChange(enabled);
  };

  return (
    <section className="stack">
      <div className="page-heading">
        <div>
          <span>Local controls</span>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="settings-list">
        <label className="setting-row">
          <div>
            <strong>Open on login</strong>
            <span>Start the desktop app when your computer boots.</span>
          </div>
          <input
            type="checkbox"
            checked={startupEnabled}
            disabled={!canUseStartup}
            onChange={(event) => void toggleStartup(event.target.checked)}
          />
        </label>

        <div className="setting-row">
          <div>
            <strong>Reminder test</strong>
            <span>Send a local OS notification without contacting a server.</span>
          </div>
          <button
            className="icon-action"
            type="button"
            disabled={!canUseNotifications}
            onClick={() => {
              void platform.notifications?.workoutReminder('Time for a short push-up session.');
              setReminderStatus('Reminder sent.');
            }}
            aria-label="Send reminder"
            title="Send reminder"
          >
            <Bell size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="setting-note">{reminderStatus}</p>
      </div>
    </section>
  );
}

function NavButton({
  icon,
  active,
  onClick,
  children,
}: {
  readonly icon: ReactElement;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: string;
}): ReactElement {
  return (
    <button className={active ? 'active' : undefined} type="button" onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactElement {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function createSession(): WorkoutSession {
  return {
    id: `session_${crypto.randomUUID()}`,
    startedAt: new Date().toISOString(),
    exercises: [],
    notes: undefined,
  };
}

function createExerciseSet(
  startedAt: string,
  endedAt: string,
  cameraAngle: CameraAngle,
  state: ExerciseDetectorState,
  repEvents: readonly RepEvent[],
): ExerciseSet {
  return {
    id: `set_${crypto.randomUUID()}`,
    exerciseType: 'push_up',
    cameraAngle,
    startedAt,
    endedAt,
    reps: state.reps,
    validReps: state.validReps,
    partialReps: state.partialReps,
    formWarnings: state.warnings,
    repEvents,
  };
}

function drawOverlay(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement,
  frame: PoseFrame | undefined,
): void {
  if (!canvas) {
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!frame) {
    return;
  }

  context.fillStyle = '#27ae60';
  context.strokeStyle = '#f2c94c';
  context.lineWidth = 4;

  const pairs: readonly [LandmarkName, LandmarkName][] = [
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'left_knee'],
    ['left_knee', 'left_ankle'],
    ['right_hip', 'right_knee'],
    ['right_knee', 'right_ankle'],
  ];

  for (const [from, to] of pairs) {
    const a = frame.landmarks.get(from);
    const b = frame.landmarks.get(to);

    if (!a || !b) {
      continue;
    }

    context.beginPath();
    context.moveTo(a.x * canvas.width, a.y * canvas.height);
    context.lineTo(b.x * canvas.width, b.y * canvas.height);
    context.stroke();
  }

  for (const landmark of frame.landmarks.values()) {
    if ((landmark.visibility ?? 0) < 0.5) {
      continue;
    }

    context.beginPath();
    context.arc(landmark.x * canvas.width, landmark.y * canvas.height, 5, 0, Math.PI * 2);
    context.fill();
  }
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  const context = canvas?.getContext('2d');

  if (!canvas || !context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
}

function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (hasUsableVideoFrame(video)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          'Camera stream opened, but no video frames arrived. Check camera permissions for the app shown in the system camera indicator.',
        ),
      );
    }, 8000);

    const poll = window.setInterval(() => {
      if (hasUsableVideoFrame(video)) {
        cleanup();
        resolve();
      }
    }, 100);

    const frameCallback =
      'requestVideoFrameCallback' in video
        ? video.requestVideoFrameCallback(() => {
            if (hasUsableVideoFrame(video)) {
              cleanup();
              resolve();
            }
          })
        : undefined;

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      if (frameCallback !== undefined && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(frameCallback);
      }
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('playing', handleLoadedData);
      video.removeEventListener('error', handleError);
    };

    const handleLoadedData = () => {
      if (!hasUsableVideoFrame(video)) {
        return;
      }

      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Camera preview failed to load.'));
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('playing', handleLoadedData);
    video.addEventListener('error', handleError, { once: true });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

function hasUsableVideoFrame(video: HTMLVideoElement): boolean {
  return (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

function stopCamera(video: HTMLVideoElement | null): void {
  if (!video) {
    return;
  }

  const stream = video.srcObject as MediaStream | null;
  stopMediaStream(stream);
  video.pause();
  video.removeAttribute('src');
  video.srcObject = null;
  video.load();
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function formatPhase(phase: string): string {
  return phase.replaceAll('_', ' ');
}

function formatMetric(value: number | undefined, unit: 'deg' | '%'): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  return unit === '%' ? `${Math.round(value * 100)}%` : `${Math.round(value)}deg`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
