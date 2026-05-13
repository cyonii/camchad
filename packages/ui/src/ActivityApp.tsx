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
  Settings,
  Square,
  Sun,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import type {
  ActivitySessionTelemetry,
  CameraAngle,
  MovementInterpreterState,
  MovementType,
} from '@camchad/movement-core';
import {
  ActivitySessionOrchestrator,
  createMovementRecognitionEngine,
  movementDefinitionFor,
  movementRegistry,
  type MovementDefinition,
} from '@camchad/movement-core';
import {
  ExponentialPoseSmoother,
  MediaPipePoseEstimator,
  type LandmarkName,
  type PoseEstimator,
  type PoseFrame,
} from '@camchad/pose-core';
import {
  ActivitySessionService,
  type ActivityRepository,
  type MovementSegment,
  type ActivitySession,
  type ActivitySummary,
} from '@camchad/activity-history';

import type { ActivityPlatform } from './platform.js';
import { buildHistoryChartModel } from './history-chart.js';

const ActivityLogChart = lazy(async () => {
  const module = await import('./ActivityLogChart.js');

  return { default: module.ActivityLogChart };
});

type View = 'activity' | 'history' | 'settings';
type ThemePreference = 'system' | 'light' | 'dark';
type TelemetryMode = 'fixed' | 'engraved';

export interface ActivityAssets {
  readonly logoAssetPath?: string;
  readonly modelAssetPath: string;
  readonly wasmAssetPath: string;
}

export interface ActivityAppProps {
  readonly assets: ActivityAssets;
  readonly platform: ActivityPlatform;
}

const themePreferenceStorageKey = 'camchad:theme-preference';
const legacyThemePreferenceStorageKey = 'home-activity:theme-preference';
const telemetryModeStorageKey = 'camchad:telemetry-mode';
const legacyTelemetryModeStorageKey = 'home-activity:telemetry-mode';
const poseInferenceIntervalMs = 80;
const defaultMovementDefinition = defaultCatalogDefinition();
const defaultCameraAngle: CameraAngle = defaultMovementDefinition.defaultCameraAngle;
const initialDetectorState: MovementInterpreterState = {
  movementType: defaultMovementDefinition.type,
  recognition: {
    confidence: 0,
    status: 'tracking_lost',
    evidence: [],
  },
  phase: 'setup_needed',
  reps: 0,
  validReps: 0,
  partialReps: 0,
  warnings: [],
  metrics: {},
};
const initialSessionTelemetry: ActivitySessionTelemetry = {
  mode: 'idle',
  recognitionConfidence: 0,
};

interface ShellSessionTelemetry {
  readonly isActive: boolean;
  readonly elapsedSeconds: number;
  readonly mode: ActivitySessionTelemetry['mode'];
}

export function ActivityApp({ assets, platform }: ActivityAppProps): ReactElement {
  const [view, setView] = useState<View>('activity');
  const [sessions, setSessions] = useState<readonly ActivitySession[]>([]);
  const [summary, setSummary] = useState<ActivitySummary>({
    totalSessions: 0,
    totalReps: 0,
    validReps: 0,
    partialReps: 0,
  });
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [shellSessionTelemetry, setShellSessionTelemetry] = useState<ShellSessionTelemetry>({
    isActive: false,
    elapsedSeconds: 0,
    mode: 'idle',
  });
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
    async (session: ActivitySession) => {
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
            <strong>CamChad</strong>
            <span>Local tracker</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <NavButton
            icon={<Activity size={18} />}
            active={view === 'activity'}
            onClick={() => setView('activity')}
          >
            Activity
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
          <SidebarSessionTelemetry telemetry={shellSessionTelemetry} />
          <div className="sidebar-summary">
            <span>Total movement reps</span>
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
        {view === 'activity' ? (
          <ActivityView
            assets={assets}
            platform={platform}
            onSessionSaved={saveSession}
            onShellSessionTelemetryChange={setShellSessionTelemetry}
          />
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

function ActivityView({
  assets,
  platform,
  onSessionSaved,
  onShellSessionTelemetryChange,
}: {
  readonly assets: ActivityAssets;
  readonly platform: ActivityPlatform;
  readonly onSessionSaved: (session: ActivitySession) => Promise<void>;
  readonly onShellSessionTelemetryChange: (telemetry: ShellSessionTelemetry) => void;
}): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const estimatorRef = useRef<PoseEstimator | null>(null);
  const smootherRef = useRef(new ExponentialPoseSmoother());
  const recognitionEngineRef = useRef(createMovementRecognitionEngine());
  const sessionOrchestratorRef = useRef(
    new ActivitySessionOrchestrator({ cameraAngle: defaultCameraAngle }),
  );
  const animationFrameRef = useRef<number | undefined>(undefined);
  const sessionRef = useRef<ActivitySession | undefined>(undefined);
  const sessionServiceRef = useRef<ActivitySessionService | undefined>(undefined);
  const activeMovementTypeRef = useRef<MovementType | undefined>(undefined);
  const hasRecordableActivityRef = useRef(false);
  const startTokenRef = useRef(0);
  const startInFlightRef = useRef(false);
  const lastInferenceAtRef = useRef(0);
  const detectorStateRef = useRef<MovementInterpreterState>(initialDetectorState);

  const [isStarting, setIsStarting] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [sessionTelemetry, setSessionTelemetry] =
    useState<ActivitySessionTelemetry>(initialSessionTelemetry);
  const [status, setStatus] = useState('Ready');
  const [detectorState, setDetectorState] =
    useState<MovementInterpreterState>(initialDetectorState);
  const [cameraError, setCameraError] = useState<string | undefined>();
  const [telemetryMode, setTelemetryMode] = useState<TelemetryMode>(() => readTelemetryMode());

  useEffect(() => {
    detectorStateRef.current = detectorState;
  }, [detectorState]);

  useEffect(() => {
    writeTelemetryMode(telemetryMode);
  }, [telemetryMode]);

  useEffect(() => {
    if (!isTracking || !sessionRef.current) {
      setSessionElapsedSeconds(0);
      return undefined;
    }

    const updateElapsed = (): void => {
      const startedAt = sessionRef.current?.startedAt;

      if (!startedAt) {
        setSessionElapsedSeconds(0);
        return;
      }

      setSessionElapsedSeconds(
        Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)),
      );
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);

    return () => window.clearInterval(intervalId);
  }, [isTracking]);

  useEffect(() => {
    onShellSessionTelemetryChange({
      isActive: isTracking || isStarting,
      elapsedSeconds: sessionElapsedSeconds,
      mode: sessionTelemetry.mode,
    });
  }, [
    isStarting,
    isTracking,
    onShellSessionTelemetryChange,
    sessionElapsedSeconds,
    sessionTelemetry.mode,
  ]);

  useEffect(() => {
    return () =>
      onShellSessionTelemetryChange({
        isActive: false,
        elapsedSeconds: 0,
        mode: 'idle',
      });
  }, [onShellSessionTelemetryChange]);

  const endActiveMovement = useCallback((): void => {
    const service = sessionServiceRef.current;

    if (!service || !activeMovementTypeRef.current) {
      return;
    }

    const completedMovement = service.endMovement();
    hasRecordableActivityRef.current =
      hasRecordableActivityRef.current || isRecordableMovement(completedMovement);
    activeMovementTypeRef.current = undefined;
    recognitionEngineRef.current.reset();
  }, []);

  const syncMovementRecording = useCallback(
    (state: MovementInterpreterState, telemetry: ActivitySessionTelemetry): void => {
      const service = sessionServiceRef.current;

      if (!service) {
        return;
      }

      if (telemetry.mode === 'resting' || telemetry.mode === 'idle') {
        endActiveMovement();
        return;
      }

      if (telemetry.mode !== 'moving' || !telemetry.movementType) {
        return;
      }

      if (
        activeMovementTypeRef.current &&
        activeMovementTypeRef.current !== telemetry.movementType
      ) {
        endActiveMovement();
      }

      if (!activeMovementTypeRef.current) {
        service.startMovement(telemetry.movementType, defaultCameraAngle);
        activeMovementTypeRef.current = telemetry.movementType;
      }

      const updatedMovement = service.updateMovement(state);
      hasRecordableActivityRef.current =
        hasRecordableActivityRef.current || isRecordableMovement(updatedMovement);
    },
    [endActiveMovement],
  );

  const processFrame = useCallback(
    (timestampMs: number): void => {
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
      const nextState = recognitionEngineRef.current.processPose(smoothed).primary;
      const nextSessionTelemetry = sessionOrchestratorRef.current.process(nextState, timestampMs);
      detectorStateRef.current = nextState;
      setDetectorState(nextState);
      setSessionTelemetry(nextSessionTelemetry);
      syncMovementRecording(nextState, nextSessionTelemetry);

      drawOverlay(canvasRef.current, video, smoothed);
      animationFrameRef.current = requestAnimationFrame(processFrame);
    },
    [syncMovementRecording],
  );

  const startActivity = useCallback(async () => {
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
      recognitionEngineRef.current = createMovementRecognitionEngine({
        cameraAngle: defaultCameraAngle,
      });
      sessionOrchestratorRef.current.reset();
      sessionOrchestratorRef.current.updateOptions({ cameraAngle: defaultCameraAngle });
      lastInferenceAtRef.current = 0;
      smootherRef.current.reset();
      activeMovementTypeRef.current = undefined;
      hasRecordableActivityRef.current = false;
      sessionServiceRef.current = new ActivitySessionService(
        createSessionRepository(onSessionSaved),
      );
      sessionRef.current = sessionServiceRef.current.startSession();

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
    isTracking,
    onSessionSaved,
    platform.cameraPermission,
    processFrame,
  ]);

  const stopActivity = useCallback(async () => {
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

    const sessionService = sessionServiceRef.current;

    if (sessionService) {
      endActiveMovement();

      if (hasRecordableActivityRef.current) {
        await sessionService.endSession();
      }
    }

    sessionRef.current = undefined;
    sessionServiceRef.current = undefined;
    activeMovementTypeRef.current = undefined;
    hasRecordableActivityRef.current = false;
    sessionOrchestratorRef.current.reset();
    setSessionElapsedSeconds(0);
    setSessionTelemetry(initialSessionTelemetry);
    detectorStateRef.current = initialDetectorState;
    setDetectorState(initialDetectorState);
    setStatus('Ready');
  }, [endActiveMovement]);

  return (
    <section className={`activity-layout telemetry-${telemetryMode}`}>
      <div className="activity-command-grid">
        <div className="activity-stage-panel">
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

            {telemetryMode === 'engraved' ? (
              <MirrorTelemetryOverlay
                status={status}
                detectorState={detectorState}
                sessionTelemetry={sessionTelemetry}
                telemetryMode={telemetryMode}
                onTelemetryModeChange={setTelemetryMode}
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
          <SidebarTelemetryPanel
            status={status}
            detectorState={detectorState}
            sessionTelemetry={sessionTelemetry}
            telemetryMode={telemetryMode}
            onTelemetryModeChange={setTelemetryMode}
          />
        ) : null}
      </div>

      <div className="bottom-command-deck">
        <div className="command-module command-module-guidance">
          <span>Camera guidance</span>
          <div className="camera-guidance">
            <strong>{sessionTelemetry.cameraAdvice?.title ?? 'Awaiting movement'}</strong>
            <small>
              {sessionTelemetry.cameraAdvice?.message ??
                'Step into frame and begin moving for automatic movement guidance.'}
            </small>
          </div>
        </div>

        <div className="command-module command-module-session">
          <span>Session</span>
          <div className="control-row">
            {!isTracking && !isStarting ? (
              <button className="primary-action" type="button" onClick={() => void startActivity()}>
                <Play size={18} aria-hidden="true" />
                Start
              </button>
            ) : (
              <>
                <button className="secondary-action" type="button" disabled>
                  <Pause size={18} aria-hidden="true" />
                  {isStarting ? 'Starting' : 'Pause'}
                </button>
                <button className="danger-action" type="button" onClick={() => void stopActivity()}>
                  <Square size={18} aria-hidden="true" />
                  Stop
                </button>
              </>
            )}
          </div>
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

interface SidebarTelemetryProps {
  readonly status: string;
  readonly detectorState: MovementInterpreterState;
  readonly sessionTelemetry: ActivitySessionTelemetry;
  readonly telemetryMode: TelemetryMode;
  readonly onTelemetryModeChange: (mode: TelemetryMode) => void;
}

function SidebarTelemetryPanel({
  status,
  detectorState,
  sessionTelemetry,
  telemetryMode,
  onTelemetryModeChange,
}: SidebarTelemetryProps): ReactElement {
  const movementDefinition = movementDefinitionFor(
    sessionTelemetry.movementType ??
      detectorState.recognition.movementType ??
      detectorState.movementType,
  );
  const telemetryMetrics = telemetryMetricsFor(movementDefinition, detectorState);

  return (
    <aside className="telemetry-panel telemetry-panel-fixed" aria-label="Movement telemetry">
      <div className="telemetry-panel-header">
        <div>
          <span>Movement</span>
          <strong>{sessionTelemetry.movementType ? movementDefinition.label : 'Observing'}</strong>
          <small>
            {status} / {formatSessionMode(sessionTelemetry.mode)}
          </small>
        </div>
        <TelemetryModeControl value={telemetryMode} onChange={onTelemetryModeChange} />
      </div>

      <div className="rep-counter telemetry-block">
        <div>
          <span>Valid reps</span>
          <strong>{detectorState.validReps}</strong>
          <small>{detectorState.partialReps} partial reps</small>
        </div>
        <SignalDial value={detectorState.metrics.poseConfidence} phase={detectorState.phase} />
      </div>

      <div className="metric-grid telemetry-block">
        <Metric label="Session" value={formatSessionMode(sessionTelemetry.mode)} />
        <Metric
          label="Recognition"
          value={formatMetric(sessionTelemetry.recognitionConfidence, '%')}
        />
        <Metric label="Phase" value={formatPhase(detectorState.phase)} />
        {telemetryMetrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>

      {sessionTelemetry.cameraAdvice ? (
        <div
          className="camera-advice telemetry-block"
          data-severity={sessionTelemetry.cameraAdvice.severity}
        >
          <span>{sessionTelemetry.cameraAdvice.title}</span>
          <p>{sessionTelemetry.cameraAdvice.message}</p>
        </div>
      ) : null}

      <div className="form-feedback telemetry-block">
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

      <div className="rep-history-strip telemetry-block" aria-label="Current rep history">
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
}

function MirrorTelemetryOverlay({
  status,
  detectorState,
  sessionTelemetry,
  telemetryMode,
  onTelemetryModeChange,
}: SidebarTelemetryProps): ReactElement {
  const movementDefinition = movementDefinitionFor(
    sessionTelemetry.movementType ??
      detectorState.recognition.movementType ??
      detectorState.movementType,
  );
  const telemetryMetrics = telemetryMetricsFor(movementDefinition, detectorState);
  const formMessage =
    detectorState.warnings.length === 0
      ? 'Tracking conditions look usable.'
      : detectorState.warnings[0]?.message;

  return (
    <aside className="mirror-telemetry" aria-label="Movement mirror telemetry">
      <div className="mirror-telemetry-controls">
        <TelemetryModeControl value={telemetryMode} onChange={onTelemetryModeChange} />
      </div>

      <div className="mirror-telemetry-heading">
        <span>Movement</span>
        <strong>{sessionTelemetry.movementType ? movementDefinition.label : 'Observing'}</strong>
        <small>
          {status} / {formatSessionMode(sessionTelemetry.mode)}
        </small>
      </div>

      <dl className="mirror-telemetry-readout">
        <div className="mirror-primary-metric">
          <dt>Valid reps</dt>
          <dd>{detectorState.validReps}</dd>
        </div>
        <div>
          <dt>Partial</dt>
          <dd>{detectorState.partialReps}</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>{formatPhase(detectorState.phase)}</dd>
        </div>
        {telemetryMetrics.slice(0, 3).map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
        <div>
          <dt>Recognition</dt>
          <dd>{formatMetric(sessionTelemetry.recognitionConfidence, '%')}</dd>
        </div>
      </dl>

      <p className="mirror-form-message">{sessionTelemetry.cameraAdvice?.message ?? formMessage}</p>
    </aside>
  );
}

function TelemetryModeControl({
  value,
  onChange,
}: {
  readonly value: TelemetryMode;
  readonly onChange: (mode: TelemetryMode) => void;
}): ReactElement {
  return (
    <div className="telemetry-mode-control" role="group" aria-label="Telemetry panel mode">
      <button type="button" aria-pressed={value === 'fixed'} onClick={() => onChange('fixed')}>
        <PanelRight size={15} aria-hidden="true" />
        Sidebar
      </button>
      <button
        type="button"
        aria-pressed={value === 'engraved'}
        onClick={() => onChange('engraved')}
      >
        <Move size={15} aria-hidden="true" />
        Mirror
      </button>
    </div>
  );
}

function SignalDial({
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
      <span>Signal</span>
    </div>
  );
}

function HistoryView({
  sessions,
  summary,
}: {
  readonly sessions: readonly ActivitySession[];
  readonly summary: ActivitySummary;
}): ReactElement {
  const chartModel = buildHistoryChartModel(sessions);
  const latestSession = sessions[0];
  const overview = historyOverviewFor(sessions);

  return (
    <section className="history-command-center">
      <div className="history-primary-column">
        <div className="history-heading-row">
          <div className="page-heading history-page-heading">
            <div>
              <span>Session logs</span>
              <h1>Movement history</h1>
              <p>Review local activity sessions, movement segments, and rep quality.</p>
            </div>
          </div>

          <div className="history-window-badge">
            <History size={16} aria-hidden="true" />
            <span>{formatHistoryWindow(sessions)}</span>
          </div>
        </div>

        <div className="history-stat-grid">
          <HistoryStatCard
            label="Total sessions"
            value={String(summary.totalSessions)}
            detail={`${chartModel.totalSets} movement sets`}
            points={chartModel.points.map((point) => point.sessionCount)}
          />
          <HistoryStatCard
            label="Total time"
            value={formatLongDuration(overview.totalDurationSeconds)}
            detail={`${overview.movementTypeCount} movement types`}
            points={chartModel.points.map((point) => point.durationSeconds)}
          />
          <HistoryStatCard
            label="Total reps"
            value={String(summary.totalReps)}
            detail={`${summary.validReps} valid / ${summary.partialReps} partial`}
            points={chartModel.points.map((point) => point.totalReps)}
          />
          <HistoryStatCard
            label="Avg quality"
            value={formatQualityScore(overview.averageQuality)}
            detail={`${chartModel.totalWarnings} form warnings`}
            points={chartModel.points.map((point) => point.averageQuality)}
          />
        </div>

        <Suspense fallback={<div className="chart-empty">Loading activity chart...</div>}>
          <ActivityLogChart model={chartModel} />
        </Suspense>

        <section className="history-table-panel" aria-labelledby="sessions-table-title">
          <div className="history-section-heading">
            <div>
              <span>Sessions</span>
              <h2 id="sessions-table-title">Recorded activity</h2>
            </div>
            <small>
              {sessions.length === 0 ? 'No sessions' : `${sessions.length} local sessions`}
            </small>
          </div>

          <div className="history-table">
            <div className="history-table-row history-table-head">
              <span>Date</span>
              <span>Duration</span>
              <span>Movements</span>
              <span>Reps</span>
              <span>Quality</span>
              <span>Warnings</span>
            </div>

            {sessions.length === 0 ? (
              <div className="empty-state">No saved activities yet.</div>
            ) : (
              sessions.map((session) => (
                <article className="history-table-row" key={session.id}>
                  <div>
                    <strong>{formatCompactDate(session.startedAt)}</strong>
                    <small>{formatCompactTime(session.startedAt)}</small>
                  </div>
                  <span>{formatDuration(session.durationSeconds ?? 0)}</span>
                  <span>{formatSessionMovementNames(session)}</span>
                  <span>{sessionTotalReps(session)}</span>
                  <span>{formatQualityScore(sessionAverageQuality(session))}</span>
                  <span>{sessionWarningCount(session)}</span>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <aside className="history-detail-panel" aria-label="Session details">
        {latestSession ? (
          <>
            <section className="history-detail-card session-detail-hero">
              <span>Session details</span>
              <strong>{formatDate(latestSession.startedAt)}</strong>
              <div>
                <small>{formatSessionMovementSummary(latestSession)}</small>
                <b>{formatDuration(latestSession.durationSeconds ?? 0)}</b>
              </div>
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Movement breakdown</span>
                  <h2>Movement segments</h2>
                </div>
              </div>

              {latestSession.movements.length === 0 ? (
                <div className="history-empty-line">No movement segments recorded.</div>
              ) : (
                <div className="movement-breakdown-list">
                  {latestSession.movements.map((movement) => {
                    const definition = movementDefinitionFor(movement.movementType);

                    return (
                      <div key={movement.id}>
                        <div>
                          <strong>{definition.label}</strong>
                          <small>{formatCameraAngle(movement.cameraAngle)}</small>
                        </div>
                        <span>{movement.validReps}</span>
                        <span>{movement.partialReps}</span>
                        <span>{formatQualityScore(averageMovementQuality(movement))}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Performance overview</span>
                  <h2>Telemetry</h2>
                </div>
              </div>

              <div className="detail-metric-grid">
                <Metric label="Valid reps" value={String(sessionValidReps(latestSession))} />
                <Metric label="Partial reps" value={String(sessionPartialReps(latestSession))} />
                <Metric
                  label="Avg quality"
                  value={formatQualityScore(sessionAverageQuality(latestSession))}
                />
                <Metric label="Warnings" value={String(sessionWarningCount(latestSession))} />
              </div>
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Movement mix</span>
                  <h2>All-time breakdown</h2>
                </div>
              </div>

              {chartModel.movementBreakdown.length === 0 ? (
                <div className="history-empty-line">No movement mix yet.</div>
              ) : (
                <div className="chart-breakdown-grid compact-breakdown">
                  {chartModel.movementBreakdown.map((movement) => (
                    <div key={movement.movementType}>
                      <span>{movement.label}</span>
                      <strong>{movement.validReps}</strong>
                      <small>
                        {movement.sets} sets / {movement.warningCount} warnings
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="history-detail-card">
            <span>Session details</span>
            <p>No local activity has been recorded yet.</p>
          </section>
        )}
      </aside>
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
  readonly platform: ActivityPlatform;
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
    <section className="stack settings-stack">
      <div className="page-heading">
        <div>
          <span>Local controls</span>
          <h1>Settings</h1>
        </div>
      </div>

      <div className="settings-summary-grid">
        <div>
          <Activity size={18} aria-hidden="true" />
          <span>Mode</span>
          <strong>Movement analysis</strong>
        </div>
        <div>
          <Camera size={18} aria-hidden="true" />
          <span>Pose engine</span>
          <strong>MediaPipe Full</strong>
        </div>
        <div>
          <Bell size={18} aria-hidden="true" />
          <span>Catalog</span>
          <strong>{movementRegistry.length} definitions</strong>
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
              void platform.notifications?.activityReminder('Time for a short movement session.');
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

      <ExerciseCatalogPanel />
    </section>
  );
}

function ExerciseCatalogPanel(): ReactElement {
  return (
    <section className="exercise-catalog-panel" aria-labelledby="exercise-catalog-title">
      <div className="chart-heading">
        <div>
          <span>Movement catalog</span>
          <h2 id="exercise-catalog-title">Exercise definitions</h2>
        </div>
        <div className="chart-legend" aria-label="Exercise support legend">
          <span>
            <i className="legend-valid" />
            Validation
          </span>
          <span>
            <i className="legend-partial" />
            Planned
          </span>
        </div>
      </div>

      <div className="exercise-catalog-grid">
        {movementRegistry.map((definition) => (
          <article key={definition.type} data-support={definition.supportLevel}>
            <div>
              <strong>{definition.label}</strong>
              <span>{formatSupportLevel(definition.supportLevel)}</span>
            </div>
            <p>{definition.analysisSignals.slice(0, 2).join(' / ')}</p>
            <small>
              {definition.bodyOrientation} / {formatCameraAngle(definition.defaultCameraAngle)}
            </small>
          </article>
        ))}
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
    const storedPreference =
      localStorage.getItem(themePreferenceStorageKey) ??
      localStorage.getItem(legacyThemePreferenceStorageKey);

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
    const storedMode =
      localStorage.getItem(telemetryModeStorageKey) ??
      localStorage.getItem(legacyTelemetryModeStorageKey);

    if (storedMode === 'fixed' || storedMode === 'engraved') {
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
    // A blocked storage write should not prevent live activity tracking.
  }
}

function describeCameraStartupError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera access was blocked by the operating system. If CamChad is not listed in macOS Camera settings, quit the app, reopen it from /Applications, and press Start again to trigger the system prompt.';
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

function SidebarSessionTelemetry({
  telemetry,
}: {
  readonly telemetry: ShellSessionTelemetry;
}): ReactElement {
  return (
    <div className="sidebar-session-telemetry">
      <span>Current session</span>
      <strong>{formatDuration(telemetry.elapsedSeconds)}</strong>
      <small>{telemetry.isActive ? formatSessionMode(telemetry.mode) : 'Standby'}</small>
    </div>
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

function HistoryStatCard({
  label,
  value,
  detail,
  points,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly points: readonly number[];
}): ReactElement {
  const maxPoint = Math.max(1, ...points);
  const sparkPoints = points.slice(-9);

  return (
    <div className="history-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <div className="history-sparkline" aria-hidden="true">
        {sparkPoints.map((point, index) => (
          <i
            key={`${point}-${index}`}
            style={{ '--spark': `${Math.max(8, (point / maxPoint) * 100)}%` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

function telemetryMetricsFor(
  movementDefinition: MovementDefinition,
  state: MovementInterpreterState,
): readonly { readonly label: string; readonly value: string }[] {
  return movementDefinition.telemetryMetrics.map((metric) => ({
    label: metric.label,
    value: formatMetric(state.metrics[metric.key], metric.unit),
  }));
}

function createSessionRepository(
  saveSession: (session: ActivitySession) => Promise<void>,
): ActivityRepository {
  return {
    listSessions: async () => [],
    getSession: async () => undefined,
    saveSession,
    deleteSession: async () => undefined,
    summary: async () => ({
      totalSessions: 0,
      totalReps: 0,
      validReps: 0,
      partialReps: 0,
    }),
  };
}

function isRecordableMovement(movement: MovementSegment): boolean {
  return movement.reps > 0 || movement.validReps > 0 || movement.partialReps > 0;
}

function historyOverviewFor(sessions: readonly ActivitySession[]): {
  readonly totalDurationSeconds: number;
  readonly averageQuality: number | undefined;
  readonly movementTypeCount: number;
} {
  const movements = sessions.flatMap((session) => session.movements);
  const repEvents = movements.flatMap((movement) => movement.repEvents);

  return {
    totalDurationSeconds: sessions.reduce(
      (sum, session) => sum + (session.durationSeconds ?? 0),
      0,
    ),
    averageQuality:
      repEvents.length === 0
        ? undefined
        : Math.round(
            repEvents.reduce((sum, event) => sum + event.qualityScore, 0) / repEvents.length,
          ),
    movementTypeCount: new Set(movements.map((movement) => movement.movementType)).size,
  };
}

function formatSessionMovementSummary(session: ActivitySession): string {
  if (session.movements.length === 0) {
    return 'No movement segment';
  }

  const movementLabels = [
    ...new Set(
      session.movements.map((movement) => movementDefinitionFor(movement.movementType).label),
    ),
  ];
  const validReps = session.movements.reduce((sum, movement) => sum + movement.validReps, 0);
  const partialReps = session.movements.reduce((sum, movement) => sum + movement.partialReps, 0);

  return `${movementLabels.join(' + ')} / ${validReps} valid / ${partialReps} partial`;
}

function formatSessionMovementNames(session: ActivitySession): string {
  if (session.movements.length === 0) {
    return 'None';
  }

  return [
    ...new Set(
      session.movements.map((movement) => movementDefinitionFor(movement.movementType).label),
    ),
  ].join(', ');
}

function sessionTotalReps(session: ActivitySession): number {
  return session.movements.reduce((sum, movement) => sum + movement.reps, 0);
}

function sessionValidReps(session: ActivitySession): number {
  return session.movements.reduce((sum, movement) => sum + movement.validReps, 0);
}

function sessionPartialReps(session: ActivitySession): number {
  return session.movements.reduce((sum, movement) => sum + movement.partialReps, 0);
}

function sessionAverageQuality(session: ActivitySession): number | undefined {
  const repEvents = session.movements.flatMap((movement) => movement.repEvents);

  if (repEvents.length === 0) {
    return undefined;
  }

  return Math.round(
    repEvents.reduce((sum, event) => sum + event.qualityScore, 0) / repEvents.length,
  );
}

function sessionWarningCount(session: ActivitySession): number {
  return session.movements.reduce((sum, movement) => sum + movement.formWarnings.length, 0);
}

function averageMovementQuality(movement: MovementSegment): number | undefined {
  if (movement.repEvents.length === 0) {
    return undefined;
  }

  return Math.round(
    movement.repEvents.reduce((sum, event) => sum + event.qualityScore, 0) /
      movement.repEvents.length,
  );
}

function formatQualityScore(score: number | undefined): string {
  return score === undefined || score === 0 ? 'n/a' : `${score}%`;
}

function formatCameraAngle(cameraAngle: CameraAngle): string {
  return cameraAngle.replaceAll('_', ' ');
}

function formatSupportLevel(level: MovementDefinition['supportLevel']): string {
  return level === 'validation' ? 'Validation-ready' : level;
}

function defaultCatalogDefinition(): MovementDefinition {
  const definition =
    movementRegistry.find(
      (movement) => movement.supportLevel === 'validation' && movement.createInterpreter,
    ) ?? movementRegistry[0];

  if (!definition) {
    throw new Error('CamChad requires at least one exercise definition.');
  }

  return definition;
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

function formatSessionMode(mode: ActivitySessionTelemetry['mode']): string {
  return mode.replaceAll('_', ' ');
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatLongDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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

function formatCompactDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function formatCompactTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatHistoryWindow(sessions: readonly ActivitySession[]): string {
  if (sessions.length === 0) {
    return 'No sessions recorded';
  }

  const sorted = [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (!first || !last) {
    return 'No sessions recorded';
  }

  return `${formatCompactDate(first.startedAt)} - ${formatCompactDate(last.startedAt)}`;
}
