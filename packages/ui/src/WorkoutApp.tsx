import {
  Activity,
  Bell,
  Camera,
  CheckCircle2,
  CircleAlert,
  History,
  Monitor,
  Moon,
  Move,
  Pause,
  PanelRight,
  Play,
  Power,
  RotateCcw,
  Settings,
  Square,
  Sun,
} from 'lucide-react';
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react';

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
type ThemePreference = 'system' | 'light' | 'dark';
type TelemetryMode = 'fixed' | 'floating';

interface HudPosition {
  readonly x: number;
  readonly y: number;
}

export interface WorkoutAssets {
  readonly logoAssetPath?: string;
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

const themePreferenceStorageKey = 'home-workout:theme-preference';
const telemetryModeStorageKey = 'home-workout:telemetry-mode';
const telemetryHudPositionStorageKey = 'home-workout:telemetry-hud-position';
const poseInferenceIntervalMs = 80;
const defaultHudPosition: HudPosition = { x: 24, y: 24 };

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
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );

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

  useEffect(() => {
    applyThemePreference(themePreference);
    writeThemePreference(themePreference);
  }, [themePreference]);

  const saveSession = useCallback(
    async (session: WorkoutSession) => {
      await platform.history.save(session);
      await loadHistory();
    },
    [loadHistory, platform.history],
  );

  const exitApp = useCallback(() => {
    void platform.appLifecycle?.exit();
  }, [platform.appLifecycle]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img className="brand-logo" src={assets.logoAssetPath ?? '/logo.png'} alt="" />
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

        <div className="sidebar-footer">
          <div className="sidebar-summary">
            <span>Total reps</span>
            <strong>{summary.totalReps}</strong>
            <small>{summary.totalSessions} saved sessions</small>
          </div>

          <div className="sidebar-actions">
            <ThemeCycleButton value={themePreference} onChange={setThemePreference} />
            <button className="sidebar-icon-action exit-action" type="button" onClick={exitApp}>
              <Power size={18} aria-hidden="true" />
              <span>Exit</span>
            </button>
          </div>
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
            themePreference={themePreference}
            onThemePreferenceChange={setThemePreference}
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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const telemetryPanelRef = useRef<HTMLDivElement | null>(null);
  const estimatorRef = useRef<PoseEstimator | null>(null);
  const smootherRef = useRef(new ExponentialPoseSmoother());
  const detectorRef = useRef(new PushUpDetector());
  const animationFrameRef = useRef<number | undefined>(undefined);
  const telemetryDragRef = useRef<
    | {
        readonly pointerId: number;
        readonly startX: number;
        readonly startY: number;
        readonly origin: HudPosition;
      }
    | undefined
  >(undefined);
  const sessionRef = useRef<WorkoutSession | undefined>(undefined);
  const repEventsRef = useRef<RepEvent[]>([]);
  const seenRepNumbersRef = useRef(new Set<number>());
  const startTokenRef = useRef(0);
  const startInFlightRef = useRef(false);
  const lastInferenceAtRef = useRef(0);
  const detectorStateRef = useRef<ExerciseDetectorState>(initialDetectorState);

  const [cameraAngle, setCameraAngle] = useState<CameraAngle>('side');
  const [isStarting, setIsStarting] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [detectorState, setDetectorState] = useState<ExerciseDetectorState>(initialDetectorState);
  const [cameraError, setCameraError] = useState<string | undefined>();
  const [telemetryMode, setTelemetryMode] = useState<TelemetryMode>(() => readTelemetryMode());
  const [telemetryHudPosition, setTelemetryHudPosition] = useState<HudPosition>(() =>
    readTelemetryHudPosition(),
  );

  useEffect(() => {
    detectorStateRef.current = detectorState;
  }, [detectorState]);

  useEffect(() => {
    writeTelemetryMode(telemetryMode);
  }, [telemetryMode]);

  useEffect(() => {
    writeTelemetryHudPosition(telemetryHudPosition);
  }, [telemetryHudPosition]);

  const processFrame = useCallback((timestampMs: number): void => {
    const video = videoRef.current;
    const estimator = estimatorRef.current;

    if (timestampMs - lastInferenceAtRef.current < poseInferenceIntervalMs) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (!video || !estimator || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    lastInferenceAtRef.current = timestampMs;
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
      lastInferenceAtRef.current = 0;
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
      const message = describeCameraStartupError(error);
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
    lastInferenceAtRef.current = 0;
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

  const clampTelemetryHudPosition = useCallback((position: HudPosition): HudPosition => {
    const stage = stageRef.current;
    const panel = telemetryPanelRef.current;

    if (!stage || !panel) {
      return {
        x: Math.max(12, position.x),
        y: Math.max(12, position.y),
      };
    }

    const stageBounds = stage.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const inset = 16;
    const maxX = Math.max(inset, stageBounds.width - panelBounds.width - inset);
    const maxY = Math.max(inset, stageBounds.height - panelBounds.height - inset);

    return {
      x: Math.min(Math.max(inset, position.x), maxX),
      y: Math.min(Math.max(inset, position.y), maxY),
    };
  }, []);

  const startTelemetryDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (telemetryMode !== 'floating' || event.button !== 0) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      telemetryDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: telemetryHudPosition,
      };
    },
    [telemetryHudPosition, telemetryMode],
  );

  const moveTelemetryDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = telemetryDragRef.current;

      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      setTelemetryHudPosition(
        clampTelemetryHudPosition({
          x: drag.origin.x + event.clientX - drag.startX,
          y: drag.origin.y + event.clientY - drag.startY,
        }),
      );
    },
    [clampTelemetryHudPosition],
  );

  const endTelemetryDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = telemetryDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    telemetryDragRef.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const resetTelemetryHudPosition = useCallback(() => {
    setTelemetryHudPosition(clampTelemetryHudPosition(defaultHudPosition));
  }, [clampTelemetryHudPosition]);

  return (
    <section className={`workout-layout telemetry-${telemetryMode}`}>
      <div className="workout-command-grid">
        <div className="workout-stage-panel" ref={stageRef}>
          <div className="video-stage">
            <video ref={videoRef} muted playsInline autoPlay />
            <canvas ref={canvasRef} />
            {!isPreviewActive ? (
              <div className="video-placeholder">
                <Camera size={34} aria-hidden="true" />
                <span>Camera preview appears here</span>
              </div>
            ) : null}
            <StageTelemetryChrome status={status} isTracking={isTracking} />

            {telemetryMode === 'floating' ? (
              <TelemetryPanel
                ref={telemetryPanelRef}
                mode="floating"
                status={status}
                detectorState={detectorState}
                style={{
                  transform: `translate3d(${telemetryHudPosition.x}px, ${telemetryHudPosition.y}px, 0)`,
                }}
                onDragStart={startTelemetryDrag}
                onDragMove={moveTelemetryDrag}
                onDragEnd={endTelemetryDrag}
                onResetPosition={resetTelemetryHudPosition}
              />
            ) : null}
          </div>

          {cameraError ? (
            <div className="alert camera-alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{cameraError}</span>
            </div>
          ) : null}
        </div>

        {telemetryMode === 'fixed' ? (
          <TelemetryPanel
            ref={telemetryPanelRef}
            mode="fixed"
            status={status}
            detectorState={detectorState}
          />
        ) : null}
      </div>

      <div className="bottom-command-deck">
        <fieldset className="segmented-control camera-angle-control">
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

        <div className="telemetry-mode-control" role="group" aria-label="Telemetry panel mode">
          <button
            type="button"
            aria-pressed={telemetryMode === 'fixed'}
            onClick={() => setTelemetryMode('fixed')}
          >
            <PanelRight size={17} aria-hidden="true" />
            Fixed
          </button>
          <button
            type="button"
            aria-pressed={telemetryMode === 'floating'}
            onClick={() => setTelemetryMode('floating')}
          >
            <Move size={17} aria-hidden="true" />
            Floating
          </button>
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

function StageTelemetryChrome({
  status,
  isTracking,
}: {
  readonly status: string;
  readonly isTracking: boolean;
}): ReactElement {
  return (
    <>
      <div className="stage-feed-label">
        <span className={isTracking ? 'status-dot active' : 'status-dot'} />
        Live feed
      </div>
      <div className="stage-resolution-label">1280p / 30 FPS</div>
      <div className="stage-status-rail">
        <span>{status}</span>
      </div>
      <div className="stage-corner stage-corner-top-left" />
      <div className="stage-corner stage-corner-top-right" />
      <div className="stage-corner stage-corner-bottom-left" />
      <div className="stage-corner stage-corner-bottom-right" />
    </>
  );
}

interface TelemetryPanelProps {
  readonly mode: TelemetryMode;
  readonly status: string;
  readonly detectorState: ExerciseDetectorState;
  readonly style?: CSSProperties;
  readonly onDragStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onDragMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onDragEnd?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onResetPosition?: () => void;
}

const TelemetryPanel = forwardRef<HTMLDivElement, TelemetryPanelProps>(function TelemetryPanel(
  { mode, status, detectorState, style, onDragStart, onDragMove, onDragEnd, onResetPosition },
  ref,
): ReactElement {
  const confidence =
    detectorState.phase === 'tracking_lost'
      ? 'Lost'
      : formatMetric(detectorState.metrics.poseConfidence, '%');

  return (
    <aside
      className={`telemetry-panel telemetry-panel-${mode}`}
      ref={ref}
      style={style}
      aria-label="Push-up telemetry"
    >
      <div
        className="telemetry-panel-header"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div>
          <span>Push-ups</span>
          <strong>{status}</strong>
        </div>
        {mode === 'floating' ? (
          <div className="telemetry-drag-actions">
            <Move size={16} aria-hidden="true" />
            <button
              className="icon-action subtle"
              type="button"
              onClick={onResetPosition}
              aria-label="Reset telemetry HUD position"
              title="Reset HUD position"
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="rep-counter">
        <div>
          <span>Valid reps</span>
          <strong>{detectorState.validReps}</strong>
          <small>{detectorState.partialReps} partial reps</small>
        </div>
        <QualityDial value={detectorState.metrics.poseConfidence} phase={detectorState.phase} />
      </div>

      <div className="metric-grid">
        <Metric label="Phase" value={formatPhase(detectorState.phase)} />
        <Metric label="Elbow angle" value={formatMetric(detectorState.metrics.elbowAngle, 'deg')} />
        <Metric label="Alignment" value={formatMetric(detectorState.metrics.alignmentScore, '%')} />
        <Metric label="Confidence" value={confidence} />
      </div>

      <div className="form-feedback">
        <span>Form feedback</span>
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

      <div className="rep-history-strip" aria-label="Current rep history">
        <span>Rep history</span>
        <div>
          {Array.from({ length: 10 }, (_, index) => {
            const completedReps = detectorState.validReps + detectorState.partialReps;
            const isActive = index < Math.min(10, completedReps);
            const isPartial =
              isActive &&
              detectorState.partialReps > 0 &&
              index >= Math.max(0, detectorState.validReps);

            return (
              <i
                key={index}
                className={
                  isActive ? (isPartial ? 'rep-history-partial' : 'rep-history-valid') : undefined
                }
              />
            );
          })}
        </div>
      </div>
    </aside>
  );
});

function QualityDial({
  value,
  phase,
}: {
  readonly value: number | undefined;
  readonly phase: string;
}): ReactElement {
  const quality = value === undefined || phase === 'tracking_lost' ? 0 : Math.round(value * 100);
  const clampedQuality = Math.min(100, Math.max(0, quality));

  return (
    <div className="quality-dial" style={{ '--quality': `${clampedQuality}%` } as CSSProperties}>
      <strong>{phase === 'tracking_lost' ? '--' : clampedQuality}</strong>
      <span>Quality</span>
    </div>
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

      {!model.hasWorkouts ? (
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
                  {point.hasWorkout
                    ? `${point.label}: ${point.validReps} valid, ${point.partialReps} partial reps`
                    : `${point.label}: no workout`}
                </title>
                {point.totalReps > 0 ? (
                  <rect
                    className="bar-valid"
                    x={x}
                    y={validY}
                    width={barWidth}
                    height={Math.max(0, validHeight)}
                    rx="4"
                  />
                ) : (
                  <rect
                    className="bar-empty"
                    x={x}
                    y={padding.top + plotHeight - 2}
                    width={barWidth}
                    height="2"
                    rx="1"
                  />
                )}
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
                {point.totalReps > 0 ? (
                  <text
                    className="bar-value"
                    x={x + barWidth / 2}
                    y={Math.max(14, partialY - 6)}
                    textAnchor="middle"
                  >
                    {point.totalReps}
                  </text>
                ) : null}
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
  themePreference,
  onThemePreferenceChange,
}: {
  readonly platform: WorkoutPlatform;
  readonly startupEnabled: boolean;
  readonly onStartupEnabledChange: (enabled: boolean) => void;
  readonly themePreference: ThemePreference;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
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
            <strong>Theme</strong>
            <span>Follow the system by default, or pin the interface.</span>
          </div>
          <ThemeSegmentedControl value={themePreference} onChange={onThemePreferenceChange} />
        </div>

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

function ThemeCycleButton({
  value,
  onChange,
}: {
  readonly value: ThemePreference;
  readonly onChange: (preference: ThemePreference) => void;
}): ReactElement {
  const option = themeOptions.find((themeOption) => themeOption.value === value) ?? themeOptions[0];

  return (
    <button
      className="sidebar-icon-action theme-cycle-control"
      type="button"
      onClick={() => onChange(nextThemePreference(value))}
      aria-label={`Theme: ${option.label}. Click to cycle theme.`}
      title={`Theme: ${option.label}`}
    >
      {option.icon}
      <span>{option.shortLabel}</span>
    </button>
  );
}

function ThemeSegmentedControl({
  value,
  onChange,
}: {
  readonly value: ThemePreference;
  readonly onChange: (preference: ThemePreference) => void;
}): ReactElement {
  return (
    <div className="theme-segmented-control" role="group" aria-label="Theme">
      {themeOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

const themeOptions: readonly {
  readonly value: ThemePreference;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: ReactElement;
}[] = [
  {
    value: 'system',
    label: 'System',
    shortLabel: 'SYS',
    icon: <Monitor size={18} aria-hidden="true" />,
  },
  { value: 'dark', label: 'Dark', shortLabel: 'DRK', icon: <Moon size={18} aria-hidden="true" /> },
  { value: 'light', label: 'Frost', shortLabel: 'FST', icon: <Sun size={18} aria-hidden="true" /> },
];

function nextThemePreference(value: ThemePreference): ThemePreference {
  const index = themeOptions.findIndex((option) => option.value === value);
  const nextOption = themeOptions[(index + 1) % themeOptions.length] ?? themeOptions[0];

  return nextOption.value;
}

function readThemePreference(): ThemePreference {
  try {
    const storedPreference = localStorage.getItem(themePreferenceStorageKey);

    if (
      storedPreference === 'system' ||
      storedPreference === 'light' ||
      storedPreference === 'dark'
    ) {
      return storedPreference;
    }
  } catch {
    return 'system';
  }

  return 'system';
}

function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(themePreferenceStorageKey, preference);
  } catch {
    // A blocked storage write should not prevent the user from using the app.
  }
}

function applyThemePreference(preference: ThemePreference): void {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme');
    return;
  }

  document.documentElement.dataset.theme = preference;
}

function readTelemetryMode(): TelemetryMode {
  try {
    const storedMode = localStorage.getItem(telemetryModeStorageKey);

    if (storedMode === 'fixed' || storedMode === 'floating') {
      return storedMode;
    }
  } catch {
    return 'fixed';
  }

  return 'fixed';
}

function writeTelemetryMode(mode: TelemetryMode): void {
  try {
    localStorage.setItem(telemetryModeStorageKey, mode);
  } catch {
    // A blocked storage write should not prevent live workout tracking.
  }
}

function readTelemetryHudPosition(): HudPosition {
  try {
    const rawPosition = localStorage.getItem(telemetryHudPositionStorageKey);

    if (!rawPosition) {
      return defaultHudPosition;
    }

    const parsedPosition = JSON.parse(rawPosition) as Partial<HudPosition>;

    if (typeof parsedPosition.x === 'number' && typeof parsedPosition.y === 'number') {
      return {
        x: parsedPosition.x,
        y: parsedPosition.y,
      };
    }
  } catch {
    return defaultHudPosition;
  }

  return defaultHudPosition;
}

function writeTelemetryHudPosition(position: HudPosition): void {
  try {
    localStorage.setItem(telemetryHudPositionStorageKey, JSON.stringify(position));
  } catch {
    // A blocked storage write should not prevent live workout tracking.
  }
}

function describeCameraStartupError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera access was blocked by the operating system. If Home Workout Tracker is not listed in macOS Camera settings, quit the app, reopen it from /Applications, and press Start again to trigger the system prompt.';
    }

    if (error.name === 'NotFoundError') {
      return 'No camera was found. Connect a camera and try again.';
    }

    if (error.name === 'NotReadableError') {
      return 'The camera is already in use by another app. Close the other app and try again.';
    }
  }

  return error instanceof Error ? error.message : 'Unable to start camera tracking.';
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

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.shadowColor = 'rgb(235 223 54 / 55%)';
  context.shadowBlur = 12;
  context.strokeStyle = 'rgb(235 223 54 / 84%)';
  context.lineWidth = Math.max(2, canvas.width / 520);

  drawPoseConnections(context, frame, pairs, canvas.width, canvas.height);

  context.shadowBlur = 0;
  context.strokeStyle = 'rgb(255 245 91 / 92%)';
  context.lineWidth = Math.max(1, canvas.width / 920);

  drawPoseConnections(context, frame, pairs, canvas.width, canvas.height);

  context.fillStyle = 'rgb(89 199 121 / 94%)';
  context.shadowColor = 'rgb(89 199 121 / 58%)';
  context.shadowBlur = 10;

  for (const landmark of frame.landmarks.values()) {
    if ((landmark.visibility ?? 0) < 0.5) {
      continue;
    }

    context.beginPath();
    context.arc(
      landmark.x * canvas.width,
      landmark.y * canvas.height,
      Math.max(4, canvas.width / 260),
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  context.restore();
}

function drawPoseConnections(
  context: CanvasRenderingContext2D,
  frame: PoseFrame,
  pairs: readonly [LandmarkName, LandmarkName][],
  width: number,
  height: number,
): void {
  for (const [from, to] of pairs) {
    const a = frame.landmarks.get(from);
    const b = frame.landmarks.get(to);

    if (!a || !b) {
      continue;
    }

    context.beginPath();
    context.moveTo(a.x * width, a.y * height);
    context.lineTo(b.x * width, b.y * height);
    context.stroke();
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
