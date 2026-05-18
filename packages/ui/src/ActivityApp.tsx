import {
  Activity,
  Bell,
  Camera,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Download,
  Dumbbell,
  Filter,
  Gauge,
  History,
  Layers3,
  Lock,
  Maximize2,
  Minus,
  Monitor,
  Moon,
  Move,
  PanelRight,
  Play,
  Power,
  RadioTower,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  ActivitySessionService,
  normalizeActivityHistory,
  persistedActivityHistory,
} from '@camchad/activity-history';
import {
  ActivityStateSegmenter,
  ActivitySessionOrchestrator,
  createMovementRecognitionEngine,
  diagnoseMovement,
  evaluateCalibrationPreflight,
  extractBodyState,
  movementDefinitionFor,
  movementRegistry,
  movementReadinessChecklist,
  MovementWindow,
} from '@camchad/movement-core';
import {
  ExponentialPoseSmoother,
  PoseTraceRecorder,
  poseModelAssetPath,
  runPoseRuntimeBenchmark,
  serializePoseTrace,
} from '@camchad/pose-core';

import { deriveCameraFrameFeedback, impulseForRep } from './camera-frame-feedback.js';
import { buildHistoryChartModel } from './history-chart.js';
import { buildSessionFatigueModel } from './history-fatigue.js';
import { selectedHistorySession } from './history-session-selection.js';
import { liveTelemetryStateFor } from './live-telemetry-state.js';

import type {
  ActivityRepository,
  ActivitySession,
  ActivitySummary,
  MovementSegment,
} from '@camchad/activity-history';
import type {
  LandmarkName,
  PoseEstimator,
  PoseFrame,
  PoseModelQuality,
  PoseTrace,
} from '@camchad/pose-core';
import type { CSSProperties, MouseEvent, ReactElement, ReactNode } from 'react';

import type {
  ActivitySessionTelemetry,
  CalibrationPreflightSnapshot,
  CameraAngle,
  MovementInterpreterState,
  MovementType,
  MovementDefinition,
} from '@camchad/movement-core';
import type { CameraFrameFeedback, CameraFrameImpulse } from './camera-frame-feedback.js';
import type {
  ActivityPlatform,
  HistoryStorageInfo,
  RuntimeBenchmarkReport,
  WindowChromeState,
} from './platform.js';
const ActivityLogChart = lazy(async () => {
  const module = await import('./ActivityLogChart.js');

  return { default: module.ActivityLogChart };
});

type View = 'activity' | 'history' | 'exercises' | 'settings';
type AppRoute = {
  readonly view: View;
  readonly movementType?: MovementType;
};
type RoutingMode = 'browser' | 'memory';
type ThemePreference = 'system' | 'light' | 'dark';
type TelemetryMode = 'fixed' | 'engraved';
type SettingsResolution = 'auto' | '720p' | '1080p';
type SettingsFrameRate = '30' | '60';
type SettingsPositionGuide = 'auto' | 'side' | 'front';
type ExerciseCatalogFilter =
  | 'all'
  | MovementDefinition['maturity']
  | MovementDefinition['category'];

interface AppSettingsPreferences {
  readonly cameraDeviceId?: string;
  readonly cameraResolution: SettingsResolution;
  readonly cameraFrameRate: SettingsFrameRate;
  readonly cameraMirror: boolean;
  readonly cameraPositionGuide: SettingsPositionGuide;
  readonly skeletonVisible: boolean;
  readonly telemetryOpacity: number;
  readonly telemetryBlur: number;
  readonly autoSaveSessions: boolean;
}

interface CameraStreamInfo {
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly deviceId?: string;
  readonly requestedWidth?: number;
  readonly requestedHeight?: number;
  readonly requestedFrameRate?: number;
}

export interface ActivityAssets {
  readonly logoAssetPath?: string;
  readonly exerciseGuideAssetBasePath: string;
  readonly modelAssetPath: string;
  readonly wasmAssetPath: string;
}

export interface ActivityAppProps {
  readonly assets: ActivityAssets;
  readonly platform: ActivityPlatform;
  readonly routingMode?: RoutingMode;
}

const themePreferenceStorageKey = 'camchad:theme-preference';
const telemetryModeStorageKey = 'camchad:telemetry-mode';
const settingsPreferencesStorageKey = 'camchad:settings-preferences';
const developerTraceFlagStorageKey = 'camchad:developer-pose-trace';
const developerBenchmarkFlagStorageKey = 'camchad:developer-runtime-benchmark';
const poseInferenceIntervalMs = 80;
const runtimeBenchmarkFrameCount = 60;
const runtimeBenchmarkModelQualities: readonly PoseModelQuality[] = ['lite', 'full', 'heavy'];
const movementMaturityStates: readonly {
  readonly value: MovementDefinition['maturity'];
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}[] = [
  {
    value: 'detected',
    label: 'Detected',
    shortLabel: 'Detected',
    description: 'Setup pattern exists, but recognition is not stable yet',
  },
  {
    value: 'recognized',
    label: 'Recognized',
    shortLabel: 'Recognized',
    description: 'Movement pattern can be identified without rep counting',
  },
  {
    value: 'rep_counting',
    label: 'Count-ready',
    shortLabel: 'Counted',
    description: 'Reps or holds are counted with generic primitives',
  },
  {
    value: 'rep_validating',
    label: 'Rep-validating',
    shortLabel: 'Validated',
    description: 'Rep quality checks and warnings are active',
  },
  {
    value: 'quality_validating',
    label: 'Quality-validating',
    shortLabel: 'Quality',
    description: 'Full quality scoring is ready',
  },
  {
    value: 'planned',
    label: 'Planned',
    shortLabel: 'Planned',
    description: 'Registered as a future movement definition',
  },
];
const defaultSettingsPreferences: AppSettingsPreferences = {
  cameraDeviceId: undefined,
  cameraResolution: '720p',
  cameraFrameRate: '30',
  cameraMirror: false,
  cameraPositionGuide: 'auto',
  skeletonVisible: true,
  telemetryOpacity: 86,
  telemetryBlur: 14,
  autoSaveSessions: true,
};
const defaultMovementDefinition = defaultCatalogDefinition();
const naturalCameraAngle: CameraAngle = 'front';
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
const initialCalibrationPreflight: CalibrationPreflightSnapshot = {
  status: 'waiting',
  title: 'Calibration pending',
  message: 'Start tracking and step into frame for a camera readiness check.',
  confidence: 0,
};
const defaultWindowChromeState: WindowChromeState = {
  platform: 'browser',
  isFocused: true,
  isFullscreen: false,
  isMaximized: false,
};

function defaultRoutingMode(): RoutingMode {
  if (typeof window === 'undefined') {
    return 'memory';
  }

  return window.location.protocol === 'http:' || window.location.protocol === 'https:'
    ? 'browser'
    : 'memory';
}

function readInitialRoute(routingMode: RoutingMode): AppRoute {
  return routingMode === 'browser' ? readRouteFromLocation() : { view: 'activity' };
}

function readRouteFromLocation(): AppRoute {
  if (typeof window === 'undefined') {
    return { view: 'activity' };
  }

  return routeFromPath(window.location.pathname);
}

function routeFromPath(pathname: string): AppRoute {
  const [rootSegment = '', detailSegment] = pathname.replace(/\/+$/, '').split('/').filter(Boolean);

  if (!rootSegment) {
    return { view: 'activity' };
  }

  if (rootSegment === 'log') {
    return { view: 'history' };
  }

  if (rootSegment === 'settings') {
    return { view: 'settings' };
  }

  if (rootSegment === 'exercises') {
    return {
      view: 'exercises',
      movementType: movementTypeFromSlug(detailSegment),
    };
  }

  return { view: 'activity' };
}

function pathForRoute(route: AppRoute): string {
  if (route.view === 'activity') {
    return '/';
  }

  if (route.view === 'history') {
    return '/log';
  }

  if (route.view === 'settings') {
    return '/settings';
  }

  if (route.movementType) {
    return `/exercises/${slugForMovementType(route.movementType)}`;
  }

  return '/exercises';
}

function slugForMovementType(movementType: MovementType): string {
  return movementType.replaceAll('_', '-');
}

function movementTypeFromSlug(slug: string | undefined): MovementType | undefined {
  if (!slug) {
    return undefined;
  }

  const movementType = slug.replaceAll('-', '_') as MovementType;

  return movementRegistry.some((definition) => definition.type === movementType)
    ? movementType
    : undefined;
}

interface ShellSessionTelemetry {
  readonly isActive: boolean;
  readonly elapsedSeconds: number;
  readonly mode: ActivitySessionTelemetry['mode'];
}

export function ActivityApp({ assets, platform, routingMode }: ActivityAppProps): ReactElement {
  const activeRoutingMode = routingMode ?? defaultRoutingMode();
  const [route, setRoute] = useState<AppRoute>(() => readInitialRoute(activeRoutingMode));
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
  const [windowChromeState, setWindowChromeState] =
    useState<WindowChromeState>(defaultWindowChromeState);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );
  const [telemetryMode, setTelemetryMode] = useState<TelemetryMode>(() => readTelemetryMode());
  const [settingsPreferences, setSettingsPreferences] = useState<AppSettingsPreferences>(() =>
    readSettingsPreferences(),
  );
  const view = route.view;

  useEffect(() => {
    if (activeRoutingMode !== 'browser') {
      return undefined;
    }

    const handlePopState = (): void => {
      setRoute(readRouteFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeRoutingMode]);

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

  useEffect(() => {
    writeTelemetryMode(telemetryMode);
  }, [telemetryMode]);

  useEffect(() => {
    writeSettingsPreferences(settingsPreferences);
  }, [settingsPreferences]);

  useEffect(() => {
    const windowControls = platform.windowControls;

    if (!windowControls) {
      setWindowChromeState(defaultWindowChromeState);
      return undefined;
    }

    let isMounted = true;

    void windowControls.getState().then((state) => {
      if (isMounted) {
        setWindowChromeState(state);
      }
    });

    const unsubscribe = windowControls.subscribe?.((state) => {
      if (isMounted) {
        setWindowChromeState(state);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [platform.windowControls]);

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

  const navigateTo = useCallback(
    (nextRoute: AppRoute): void => {
      setRoute(nextRoute);

      if (activeRoutingMode !== 'browser') {
        return;
      }

      const nextPath = pathForRoute(nextRoute);

      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath);
      }
    },
    [activeRoutingMode],
  );

  const hasWindowChrome = Boolean(platform.windowControls);
  const shouldShowWindowChrome = hasWindowChrome && !windowChromeState.isFullscreen;

  return (
    <div
      className={`app-shell${hasWindowChrome ? ' app-shell-windowed' : ''}${
        shouldShowWindowChrome ? '' : ' app-shell-chrome-hidden'
      } window-platform-${windowChromeState.platform}${
        windowChromeState.isFocused ? '' : ' window-inactive'
      }`}
    >
      {shouldShowWindowChrome ? (
        <WindowChrome state={windowChromeState} controls={platform.windowControls} />
      ) : null}

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
            href={pathForRoute({ view: 'activity' })}
            onNavigate={() => navigateTo({ view: 'activity' })}
          >
            Activity
          </NavButton>
          <NavButton
            icon={<History size={18} />}
            active={view === 'history'}
            href={pathForRoute({ view: 'history' })}
            onNavigate={() => navigateTo({ view: 'history' })}
          >
            Log
          </NavButton>
          <NavButton
            icon={<Dumbbell size={18} />}
            active={view === 'exercises'}
            href={pathForRoute({ view: 'exercises' })}
            onNavigate={() => navigateTo({ view: 'exercises' })}
          >
            Exercises
          </NavButton>
          <NavButton
            icon={<Settings size={18} />}
            active={view === 'settings'}
            href={pathForRoute({ view: 'settings' })}
            onNavigate={() => navigateTo({ view: 'settings' })}
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
        <div
          className={view === 'activity' ? 'view-panel view-panel-active' : 'view-panel'}
          hidden={view !== 'activity'}
        >
          <ActivityView
            assets={assets}
            platform={platform}
            onSessionSaved={saveSession}
            onShellSessionTelemetryChange={setShellSessionTelemetry}
            telemetryMode={telemetryMode}
            onTelemetryModeChange={setTelemetryMode}
            settingsPreferences={settingsPreferences}
          />
        </div>
        {view === 'history' ? <HistoryView sessions={sessions} summary={summary} /> : null}
        {view === 'exercises' ? (
          <SupportedExercisesView
            exerciseGuideAssetBasePath={assets.exerciseGuideAssetBasePath}
            selectedMovementType={route.movementType}
            onSelectedMovementTypeChange={(movementType) =>
              navigateTo({ view: 'exercises', movementType })
            }
          />
        ) : null}
        {view === 'settings' ? (
          <SettingsView
            platform={platform}
            startupEnabled={startupEnabled}
            onStartupEnabledChange={setStartupEnabled}
            themePreference={themePreference}
            onThemePreferenceChange={setThemePreference}
            telemetryMode={telemetryMode}
            onTelemetryModeChange={setTelemetryMode}
            sessions={sessions}
            summary={summary}
            onHistoryChanged={loadHistory}
            preferences={settingsPreferences}
            onPreferencesChange={setSettingsPreferences}
          />
        ) : null}
      </main>
    </div>
  );
}

function WindowChrome({
  state,
  controls,
}: {
  readonly state: WindowChromeState;
  readonly controls: ActivityPlatform['windowControls'];
}): ReactElement {
  const isMac = state.platform === 'macos';
  const maximizeLabel =
    state.isFullscreen || state.isMaximized ? 'Restore window' : 'Maximize window';

  return (
    <header className="window-chrome" data-focused={state.isFocused}>
      <div className="window-chrome-traffic-reserve" aria-hidden="true" />
      <div className="window-chrome-identity">
        <div className="window-chrome-glyph" aria-hidden="true">
          <RadioTower size={14} />
        </div>
        <div>
          <strong>CamChad</strong>
          <span>Motion telemetry console</span>
        </div>
      </div>
      <div className="window-chrome-status" aria-hidden="true">
        <span>Local inference</span>
        <i />
        <span>{state.isFocused ? 'Active link' : 'Standby'}</span>
      </div>
      {isMac ? (
        <div className="window-chrome-native-status" aria-hidden="true">
          <Monitor size={14} />
        </div>
      ) : (
        <div className="window-control-cluster" aria-label="Window controls">
          <button
            type="button"
            aria-label="Minimize window"
            onClick={() => void controls?.minimize()}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={maximizeLabel}
            onClick={() => void controls?.toggleMaximize()}
          >
            <Maximize2 size={13} aria-hidden="true" />
          </button>
          <button
            className="window-control-close"
            type="button"
            aria-label="Close window"
            onClick={() => void controls?.close()}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </header>
  );
}

function ActivityView({
  assets,
  platform,
  onSessionSaved,
  onShellSessionTelemetryChange,
  telemetryMode,
  onTelemetryModeChange,
  settingsPreferences,
}: {
  readonly assets: ActivityAssets;
  readonly platform: ActivityPlatform;
  readonly onSessionSaved: (session: ActivitySession) => Promise<void>;
  readonly onShellSessionTelemetryChange: (telemetry: ShellSessionTelemetry) => void;
  readonly telemetryMode: TelemetryMode;
  readonly onTelemetryModeChange: (mode: TelemetryMode) => void;
  readonly settingsPreferences: AppSettingsPreferences;
}): ReactElement {
  const preferredCameraAngle = cameraAngleForSettingsPreferences(settingsPreferences);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const estimatorRef = useRef<PoseEstimator | null>(null);
  const smootherRef = useRef(new ExponentialPoseSmoother());
  const recognitionEngineRef = useRef(
    createMovementRecognitionEngine({ cameraAngle: preferredCameraAngle }),
  );
  const activityWindowRef = useRef(new MovementWindow({ maxAgeMs: 1400 }));
  const activityStateSegmenterRef = useRef(
    new ActivityStateSegmenter({
      minCoverage: 0.2,
      restAfterMs: 1200,
      idleAfterMs: 6500,
    }),
  );
  const sessionOrchestratorRef = useRef(
    new ActivitySessionOrchestrator({ cameraAngle: preferredCameraAngle }),
  );
  const animationFrameRef = useRef<number | undefined>(undefined);
  const sessionRef = useRef<ActivitySession | undefined>(undefined);
  const sessionServiceRef = useRef<ActivitySessionService | undefined>(undefined);
  const activeMovementTypeRef = useRef<MovementType | undefined>(undefined);
  const hasRecordedRestRef = useRef(false);
  const hasRecordableActivityRef = useRef(false);
  const lastRecordedInferenceStatusRef =
    useRef<ActivitySessionTelemetry['inferenceStatus']>(undefined);
  const lastRecordedCandidateRef = useRef<MovementType | undefined>(undefined);
  const lastRecordedGuidanceCodeRef = useRef<string | undefined>(undefined);
  const trackingWasLostRef = useRef(false);
  const calibrationReadyRef = useRef(false);
  const startTokenRef = useRef(0);
  const startInFlightRef = useRef(false);
  const lastInferenceAtRef = useRef(0);
  const detectorStateRef = useRef<MovementInterpreterState>(initialDetectorState);
  const developerTraceEnabledRef = useRef(readDeveloperTraceEnabled());
  const developerBenchmarkEnabledRef = useRef(readDeveloperBenchmarkEnabled());
  const poseTraceRecorderRef = useRef<PoseTraceRecorder | undefined>(undefined);
  const poseTraceMovementLabelsRef = useRef(new Set<string>());
  const benchmarkVideoRef = useRef<HTMLVideoElement | undefined>(undefined);
  const benchmarkVideoUrlRef = useRef<string | undefined>(undefined);
  const benchmarkVideoLabelRef = useRef<string | undefined>(undefined);

  const [isStarting, setIsStarting] = useState(false);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [cameraStreamInfo, setCameraStreamInfo] = useState<CameraStreamInfo | undefined>();
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [sessionTelemetry, setSessionTelemetry] =
    useState<ActivitySessionTelemetry>(initialSessionTelemetry);
  const [calibrationPreflight, setCalibrationPreflight] = useState<CalibrationPreflightSnapshot>(
    initialCalibrationPreflight,
  );
  const [status, setStatus] = useState('Ready');
  const [detectorState, setDetectorState] =
    useState<MovementInterpreterState>(initialDetectorState);
  const [cameraError, setCameraError] = useState<string | undefined>();
  const [developerTraceStatus, setDeveloperTraceStatus] = useState<string | undefined>(() =>
    developerTraceEnabledRef.current ? 'Pose trace capture armed' : undefined,
  );
  const [developerBenchmarkStatus, setDeveloperBenchmarkStatus] = useState<string | undefined>(
    () => (developerBenchmarkEnabledRef.current ? 'Runtime benchmark ready' : undefined),
  );
  const [isDeveloperBenchmarkRunning, setIsDeveloperBenchmarkRunning] = useState(false);
  const activeGuide = exerciseGuideFor(
    sessionTelemetry.movementType ??
      detectorState.recognition.movementType ??
      detectorState.movementType,
    assets.exerciseGuideAssetBasePath,
  );
  const frameImpulse = useCameraFrameImpulse(detectorState);
  const cameraFrameFeedback = deriveCameraFrameFeedback({
    isPreviewActive,
    isStarting,
    isTracking,
    cameraError,
    detectorState,
    sessionTelemetry,
    impulse: frameImpulse,
  });

  useEffect(() => {
    detectorStateRef.current = detectorState;
  }, [detectorState]);

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

  useEffect(() => {
    return () => {
      if (benchmarkVideoUrlRef.current) {
        URL.revokeObjectURL(benchmarkVideoUrlRef.current);
        benchmarkVideoUrlRef.current = undefined;
      }
    };
  }, []);

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

      recordSessionTimelineState(service, state, telemetry, {
        lastRecordedInferenceStatusRef,
        lastRecordedCandidateRef,
        lastRecordedGuidanceCodeRef,
        trackingWasLostRef,
      });

      if (telemetry.mode === 'resting' || telemetry.mode === 'idle') {
        endActiveMovement();

        if (telemetry.mode === 'resting' && !hasRecordedRestRef.current) {
          service.recordRest({
            activityState: telemetry.activityState,
            recognitionConfidence: telemetry.recognitionConfidence,
          });
          hasRecordedRestRef.current = true;
        }

        if (telemetry.mode === 'idle') {
          hasRecordedRestRef.current = false;
        }

        return;
      }

      if (telemetry.mode !== 'moving' || !telemetry.movementType) {
        return;
      }

      hasRecordedRestRef.current = false;

      if (
        activeMovementTypeRef.current &&
        activeMovementTypeRef.current !== telemetry.movementType
      ) {
        service.recordTransition({
          activityState: telemetry.activityState,
          recognitionConfidence: telemetry.recognitionConfidence,
          competingMovementTypes: [activeMovementTypeRef.current, telemetry.movementType],
          message: 'Movement pattern changed during the session.',
        });
        endActiveMovement();
      }

      if (!activeMovementTypeRef.current) {
        service.startMovement(telemetry.movementType, preferredCameraAngle);
        activeMovementTypeRef.current = telemetry.movementType;
      }

      const updatedMovement = service.updateMovement(state, {
        activityState: telemetry.activityState,
        recognitionConfidence: telemetry.recognitionConfidence,
        guidanceEvents: telemetry.guidanceEvents,
        competingMovementTypes: telemetry.competingMovementTypes,
      });
      hasRecordableActivityRef.current =
        hasRecordableActivityRef.current || isRecordableMovement(updatedMovement);
    },
    [endActiveMovement, preferredCameraAngle],
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
      if (developerTraceEnabledRef.current) {
        if (smoothed) {
          poseTraceRecorderRef.current?.addFrame(smoothed);
        } else {
          poseTraceRecorderRef.current?.addMissingFrame(timestampMs);
        }
      }
      const bodyState = extractBodyState(smoothed);
      const activityWindowSnapshot = bodyState
        ? activityWindowRef.current.add(bodyState)
        : activityWindowRef.current.addMissing(timestampMs);
      const activityState = activityStateSegmenterRef.current.process(activityWindowSnapshot);
      const recognitionState = recognitionEngineRef.current.processPose(smoothed);
      const nextState = recognitionState.primary;
      if (nextState.recognition.movementType) {
        poseTraceMovementLabelsRef.current.add(nextState.recognition.movementType);
      }
      const diagnostics = diagnoseMovement({
        activityState,
        window: activityWindowSnapshot,
        interpreterState: nextState,
        cameraAngle: preferredCameraAngle,
      });
      const preflight = evaluateCalibrationPreflight({
        activityState,
        window: activityWindowSnapshot,
        diagnostics,
      });
      setCalibrationPreflight(preflight);

      if (!calibrationReadyRef.current && preflight.status === 'ready') {
        calibrationReadyRef.current = true;
        setStatus('Tracking');
      } else if (!calibrationReadyRef.current) {
        setStatus(preflight.status === 'needs_adjustment' ? 'Calibration needed' : 'Calibrating');
      }

      const nextSessionTelemetry = {
        ...sessionOrchestratorRef.current.process(nextState, timestampMs),
        activityState: activityState.state,
        activityConfidence: activityState.confidence,
        inferenceStatus: recognitionState.inference.status,
        competingMovementTypes: recognitionState.inference.competingMovementTypes,
        guidanceEvents: diagnostics.events,
      };
      detectorStateRef.current = nextState;
      setDetectorState(nextState);
      setSessionTelemetry(nextSessionTelemetry);
      if (calibrationReadyRef.current) {
        syncMovementRecording(nextState, nextSessionTelemetry);
      }

      if (settingsPreferences.skeletonVisible) {
        drawOverlay(canvasRef.current, video, smoothed);
      } else {
        clearCanvas(canvasRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(processFrame);
    },
    [preferredCameraAngle, settingsPreferences.skeletonVisible, syncMovementRecording],
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
    calibrationReadyRef.current = false;
    setCalibrationPreflight(initialCalibrationPreflight);
    setCameraError(undefined);
    setStatus('Checking camera permission');

    try {
      const permission = await platform.cameraPermission?.ensureCameraPermission();

      if (permission && !permission.granted) {
        throw new Error(permission.reason ?? 'Camera permission was not granted.');
      }

      setStatus('Requesting camera');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: cameraCaptureConstraints(settingsPreferences),
        audio: false,
      });
      setCameraStreamInfo(cameraStreamInfoFor(stream, settingsPreferences));
      const video = videoRef.current;

      if (!video) {
        setCameraStreamInfo(undefined);
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
      setCameraStreamInfo(cameraStreamInfoFor(stream, settingsPreferences));

      if (startTokenRef.current !== startToken) {
        setCameraStreamInfo(undefined);
        stopMediaStream(stream);
        return;
      }

      setStatus('Starting pose engine');
      recognitionEngineRef.current = createMovementRecognitionEngine({
        cameraAngle: preferredCameraAngle,
      });
      activityWindowRef.current.reset();
      activityStateSegmenterRef.current.reset();
      sessionOrchestratorRef.current.reset();
      sessionOrchestratorRef.current.updateOptions({ cameraAngle: preferredCameraAngle });
      lastInferenceAtRef.current = 0;
      smootherRef.current.reset();
      activeMovementTypeRef.current = undefined;
      hasRecordedRestRef.current = false;
      hasRecordableActivityRef.current = false;
      lastRecordedInferenceStatusRef.current = undefined;
      lastRecordedCandidateRef.current = undefined;
      lastRecordedGuidanceCodeRef.current = undefined;
      trackingWasLostRef.current = false;
      calibrationReadyRef.current = false;
      sessionServiceRef.current = new ActivitySessionService(
        createSessionRepository(onSessionSaved),
      );
      sessionRef.current = sessionServiceRef.current.startSession();
      poseTraceMovementLabelsRef.current.clear();

      if (developerTraceEnabledRef.current) {
        poseTraceRecorderRef.current = new PoseTraceRecorder({
          source: 'camera',
          notes: 'Developer pose trace capture. No raw video frames are included.',
          metadata: {
            sessionId: sessionRef.current.id,
            cameraAngle: preferredCameraAngle,
            captureNotes: 'Captured from the live activity loop.',
          },
        });
        setDeveloperTraceStatus('Recording pose trace');
      }

      const { MediaPipePoseEstimator } = await import('@camchad/pose-core');
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
        poseTraceRecorderRef.current = undefined;
        return;
      }

      estimatorRef.current = estimator;
      setIsTracking(true);
      setStatus('Calibrating');
      animationFrameRef.current = requestAnimationFrame(processFrame);
    } catch (error) {
      if (startTokenRef.current !== startToken) {
        return;
      }

      stopCamera(videoRef.current);
      poseTraceRecorderRef.current = undefined;
      setIsPreviewActive(false);
      setCameraStreamInfo(undefined);
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
    preferredCameraAngle,
    processFrame,
    settingsPreferences.cameraDeviceId,
    settingsPreferences.cameraFrameRate,
    settingsPreferences.cameraResolution,
  ]);

  useEffect(() => {
    if (!isPreviewActive) {
      return;
    }

    const stream = mediaStreamForVideo(videoRef.current);
    const [track] = stream?.getVideoTracks() ?? [];

    if (!stream || !track) {
      return;
    }

    const activeStream = stream;
    let isCancelled = false;

    const applyCapturePreferences = async (): Promise<void> => {
      try {
        await track.applyConstraints(cameraLiveCaptureConstraints(settingsPreferences));

        if (!isCancelled) {
          setCameraError(undefined);
          setCameraStreamInfo(cameraStreamInfoFor(activeStream, settingsPreferences));
        }
      } catch (error) {
        if (!isCancelled) {
          setCameraStreamInfo(cameraStreamInfoFor(activeStream, settingsPreferences));
          setCameraError(describeCameraSettingsError(error, settingsPreferences));
        }
      }
    };

    void applyCapturePreferences();

    return () => {
      isCancelled = true;
    };
  }, [
    isPreviewActive,
    settingsPreferences.cameraDeviceId,
    settingsPreferences.cameraFrameRate,
    settingsPreferences.cameraResolution,
  ]);

  const exportDeveloperPoseTrace = useCallback(async (): Promise<void> => {
    const recorder = poseTraceRecorderRef.current;

    if (!recorder) {
      setDeveloperTraceStatus('No pose trace is currently buffered.');
      return;
    }

    const snapshot = recorder.snapshot();

    if (snapshot.samples.length === 0) {
      setDeveloperTraceStatus('No pose samples have been captured yet.');
      return;
    }

    const trace: PoseTrace = {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        sessionId: snapshot.metadata?.sessionId ?? sessionRef.current?.id,
        movementLabels: [...poseTraceMovementLabelsRef.current].sort(),
        cameraAngle: snapshot.metadata?.cameraAngle ?? preferredCameraAngle,
      },
    };

    if (platform.developerTools) {
      const result = await platform.developerTools.savePoseTrace(trace);
      setDeveloperTraceStatus(
        `Saved ${trace.samples.length} samples to ${result.path ?? result.filename}.`,
      );
      return;
    }

    const filename = downloadPoseTrace(trace);
    setDeveloperTraceStatus(`Downloaded ${trace.samples.length} pose samples as ${filename}.`);
  }, [platform.developerTools, preferredCameraAngle]);

  const selectDeveloperBenchmarkVideo = useCallback(
    async (file: File | undefined): Promise<void> => {
      if (!file) {
        return;
      }

      if (benchmarkVideoUrlRef.current) {
        URL.revokeObjectURL(benchmarkVideoUrlRef.current);
      }

      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = 'auto';
      benchmarkVideoRef.current = video;
      benchmarkVideoUrlRef.current = url;
      benchmarkVideoLabelRef.current = file.name;
      setDeveloperBenchmarkStatus(`Loaded benchmark video: ${file.name}`);

      await waitForVideoMetadata(video);
    },
    [],
  );

  const runDeveloperRuntimeBenchmark = useCallback(async (): Promise<void> => {
    if (isDeveloperBenchmarkRunning) {
      return;
    }

    const selectedVideo = benchmarkVideoRef.current;
    const liveVideo = videoRef.current;
    const video = selectedVideo ?? liveVideo;
    const source = selectedVideo ? 'video_file' : 'camera';
    const sourceLabel = selectedVideo
      ? benchmarkVideoLabelRef.current
      : isPreviewActive
        ? 'Live camera preview'
        : undefined;

    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
      setDeveloperBenchmarkStatus(
        selectedVideo
          ? 'Benchmark video is not ready yet.'
          : 'Start the camera or select a local benchmark video first.',
      );
      return;
    }

    setIsDeveloperBenchmarkRunning(true);
    setDeveloperBenchmarkStatus(`Benchmarking ${runtimeBenchmarkModelQualities.join(', ')}.`);

    try {
      if (selectedVideo) {
        selectedVideo.currentTime = 0;
        await selectedVideo.play();
      }

      const modelBasePath = modelAssetBasePath(assets.modelAssetPath);
      const runtime = platform.developerTools?.saveRuntimeBenchmark ? 'electron' : 'web';
      const result = await runPoseRuntimeBenchmark({
        video,
        runtime,
        frameCount: runtimeBenchmarkFrameCount,
        targets: runtimeBenchmarkModelQualities.map((modelQuality) => ({
          modelQuality,
          delegate: 'CPU',
          createEstimator: async () => {
            const { MediaPipePoseEstimator } = await import('@camchad/pose-core');

            return new MediaPipePoseEstimator({
              modelQuality,
              modelAssetPath: poseModelAssetPath(modelBasePath, modelQuality),
              wasmAssetPath: assets.wasmAssetPath,
              delegate: 'CPU',
            });
          },
        })),
      });
      const report: RuntimeBenchmarkReport = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runtime,
        source,
        sourceLabel,
        result,
      };
      const saved = platform.developerTools?.saveRuntimeBenchmark
        ? await platform.developerTools.saveRuntimeBenchmark(report)
        : { filename: downloadRuntimeBenchmarkReport(report) };

      setDeveloperBenchmarkStatus(`Saved benchmark report to ${saved.path ?? saved.filename}.`);
    } catch (error) {
      setDeveloperBenchmarkStatus(
        error instanceof Error ? error.message : 'Runtime benchmark failed.',
      );
    } finally {
      setIsDeveloperBenchmarkRunning(false);
      if (selectedVideo) {
        selectedVideo.pause();
      }
    }
  }, [
    assets.modelAssetPath,
    assets.wasmAssetPath,
    isDeveloperBenchmarkRunning,
    isPreviewActive,
    platform.developerTools,
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
    setCameraStreamInfo(undefined);
    clearCanvas(canvasRef.current);

    const sessionService = sessionServiceRef.current;

    if (sessionService) {
      endActiveMovement();

      if (hasRecordableActivityRef.current && settingsPreferences.autoSaveSessions) {
        await sessionService.endSession();
      }
    }

    if (developerTraceEnabledRef.current && poseTraceRecorderRef.current) {
      await exportDeveloperPoseTrace();
      poseTraceRecorderRef.current = undefined;
    }

    sessionRef.current = undefined;
    sessionServiceRef.current = undefined;
    activeMovementTypeRef.current = undefined;
    hasRecordedRestRef.current = false;
    hasRecordableActivityRef.current = false;
    calibrationReadyRef.current = false;
    activityWindowRef.current.reset();
    activityStateSegmenterRef.current.reset();
    sessionOrchestratorRef.current.reset();
    setSessionElapsedSeconds(0);
    setSessionTelemetry(initialSessionTelemetry);
    setCalibrationPreflight(initialCalibrationPreflight);
    detectorStateRef.current = initialDetectorState;
    setDetectorState(initialDetectorState);
    setStatus('Ready');
  }, [endActiveMovement, exportDeveloperPoseTrace, settingsPreferences.autoSaveSessions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat || isKeyboardInputTarget(event.target)) {
        return;
      }

      event.preventDefault();

      if (isTracking || isStarting) {
        void stopActivity();
        return;
      }

      void startActivity();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStarting, isTracking, startActivity, stopActivity]);

  const visibleGuidance =
    primaryGuidanceFor(sessionTelemetry) ??
    (isTracking || isStarting ? calibrationPreflight : undefined) ??
    sessionTelemetry.cameraAdvice;

  return (
    <section
      className={`activity-layout telemetry-${telemetryMode}${
        settingsPreferences.cameraMirror ? ' camera-mirrored' : ''
      }`}
      style={
        {
          '--activity-hud-opacity': `${settingsPreferences.telemetryOpacity / 100}`,
          '--activity-hud-blur': `${settingsPreferences.telemetryBlur}px`,
        } as CSSProperties
      }
    >
      <div className="activity-command-grid">
        <div
          className="activity-stage-panel"
          data-frame-tone={cameraFrameFeedback.tone}
          data-frame-impulse={cameraFrameFeedback.impulse ?? 'none'}
          style={
            {
              '--camera-frame-intensity': cameraFrameFeedback.intensity.toFixed(2),
              '--camera-frame-confidence': cameraFrameFeedback.confidence.toFixed(2),
            } as CSSProperties
          }
        >
          <div className="video-stage">
            <video ref={videoRef} muted playsInline autoPlay />
            <canvas ref={canvasRef} />
            {!isPreviewActive ? (
              <div className="video-placeholder">
                <Camera size={34} aria-hidden="true" />
                <span>Camera preview appears here</span>
              </div>
            ) : null}
            <StageTelemetryChrome
              status={status}
              isTracking={isTracking}
              cameraStreamInfo={cameraStreamInfo}
              feedback={cameraFrameFeedback}
            />
            {activeGuide && detectorState.recognition.status === 'active' ? (
              <ExerciseGuideOverlay guide={activeGuide} />
            ) : null}

            {telemetryMode === 'engraved' ? (
              <MirrorTelemetryOverlay
                status={status}
                detectorState={detectorState}
                sessionTelemetry={sessionTelemetry}
                telemetryMode={telemetryMode}
                onTelemetryModeChange={onTelemetryModeChange}
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
            cameraStreamInfo={cameraStreamInfo}
            telemetryMode={telemetryMode}
            onTelemetryModeChange={onTelemetryModeChange}
          />
        ) : null}
      </div>

      <div className="bottom-command-deck">
        <div className="command-module command-module-guidance">
          <span>Camera guidance</span>
          <div
            className="camera-guidance"
            role="status"
            aria-live="polite"
            data-severity={guidanceSeverity(visibleGuidance)}
          >
            <strong>{visibleGuidance?.title ?? 'Awaiting movement'}</strong>
            <small>
              {visibleGuidance?.message ??
                'Step into frame and begin moving for automatic movement guidance.'}
            </small>
          </div>
        </div>

        {developerTraceEnabledRef.current ? (
          <div className="command-module command-module-trace">
            <span>Pose trace</span>
            <div className="developer-tool-panel">
              <small>{developerTraceStatus ?? 'Developer capture enabled'}</small>
              <button
                className="secondary-action compact-action"
                type="button"
                onClick={() => void exportDeveloperPoseTrace()}
              >
                <Download size={16} aria-hidden="true" />
                Export
              </button>
            </div>
          </div>
        ) : null}

        {developerBenchmarkEnabledRef.current ? (
          <div className="command-module command-module-benchmark">
            <span>Runtime benchmark</span>
            <div className="developer-tool-panel">
              <small>{developerBenchmarkStatus ?? 'Select video or use live preview'}</small>
              <label className="secondary-action compact-action file-action">
                <Upload size={16} aria-hidden="true" />
                Video
                <input
                  accept="video/*"
                  type="file"
                  onChange={(event) =>
                    void selectDeveloperBenchmarkVideo(event.currentTarget.files?.[0])
                  }
                />
              </label>
              <button
                className="secondary-action compact-action"
                type="button"
                disabled={isDeveloperBenchmarkRunning}
                onClick={() => void runDeveloperRuntimeBenchmark()}
              >
                <Gauge size={16} aria-hidden="true" />
                {isDeveloperBenchmarkRunning ? 'Running' : 'Run'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="command-module command-module-session">
          <span>Session</span>
          <div className="control-row">
            {!isTracking && !isStarting ? (
              <button className="primary-action" type="button" onClick={() => void startActivity()}>
                <Play size={18} aria-hidden="true" />
                Start
              </button>
            ) : (
              <button className="danger-action" type="button" onClick={() => void stopActivity()}>
                <Square size={18} aria-hidden="true" />
                Stop
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ExerciseGuideOverlay({ guide }: { readonly guide: ExerciseGuide }): ReactElement {
  return (
    <aside className="exercise-guide-overlay" aria-label={`${guide.label} form guide`}>
      <img src={guide.src} alt="" />
      <div>
        <span>Form guide</span>
        <strong>{guide.label}</strong>
      </div>
    </aside>
  );
}

function useCameraFrameImpulse(
  detectorState: MovementInterpreterState,
): CameraFrameImpulse | undefined {
  const lastRepNumberRef = useRef<number | undefined>(undefined);
  const previousPhaseRef = useRef(detectorState.phase);
  const previousRecognitionStatusRef = useRef(detectorState.recognition.status);
  const [impulse, setImpulse] = useState<CameraFrameImpulse | undefined>();

  useEffect(() => {
    const lastRep = detectorState.lastRep;

    if (lastRep && lastRepNumberRef.current !== lastRep.repNumber) {
      lastRepNumberRef.current = lastRep.repNumber;
      setImpulse(impulseForRep(lastRep));
    } else if (
      detectorState.phase === 'invalid_form' &&
      previousPhaseRef.current !== 'invalid_form'
    ) {
      setImpulse('posture_break');
    } else if (
      detectorState.recognition.status === 'tracking_lost' &&
      previousRecognitionStatusRef.current !== 'tracking_lost'
    ) {
      setImpulse('tracking_lost');
    }

    previousPhaseRef.current = detectorState.phase;
    previousRecognitionStatusRef.current = detectorState.recognition.status;
  }, [detectorState]);

  useEffect(() => {
    if (!impulse) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setImpulse(undefined), 620);

    return () => window.clearTimeout(timeoutId);
  }, [impulse]);

  return impulse;
}

function StageTelemetryChrome({
  status,
  isTracking,
  cameraStreamInfo,
  feedback,
}: {
  readonly status: string;
  readonly isTracking: boolean;
  readonly cameraStreamInfo: CameraStreamInfo | undefined;
  readonly feedback: CameraFrameFeedback;
}): ReactElement {
  return (
    <>
      <div className="stage-feed-label">
        <span className={isTracking ? 'status-dot active' : 'status-dot'} />
        Live feed
      </div>
      <div className="stage-resolution-label">{formatCameraStreamInfo(cameraStreamInfo)}</div>
      <div className="stage-status-rail">
        <span>{status}</span>
      </div>
      <div className="stage-frame-feedback" aria-hidden="true">
        <span className="stage-edge stage-edge-top" />
        <span className="stage-edge stage-edge-right" />
        <span className="stage-edge stage-edge-bottom" />
        <span className="stage-edge stage-edge-left" />
        <span className="stage-scanline" />
      </div>
      <div className="stage-feedback-label visually-hidden" aria-live="polite">
        {feedback.label}
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
  readonly cameraStreamInfo?: CameraStreamInfo;
  readonly telemetryMode: TelemetryMode;
  readonly onTelemetryModeChange: (mode: TelemetryMode) => void;
}

function SidebarTelemetryPanel({
  status,
  detectorState,
  sessionTelemetry,
  cameraStreamInfo,
  telemetryMode,
  onTelemetryModeChange,
}: SidebarTelemetryProps): ReactElement {
  const movementDefinition = movementDefinitionFor(
    sessionTelemetry.movementType ??
      detectorState.recognition.movementType ??
      detectorState.movementType,
  );
  const telemetryMetrics = telemetryMetricsFor(movementDefinition, detectorState);
  const telemetrySignal = strongestTelemetrySignal(detectorState, sessionTelemetry);
  const liveState = liveTelemetryStateFor(detectorState, sessionTelemetry);

  return (
    <aside className="telemetry-panel telemetry-panel-fixed" aria-label="Movement telemetry">
      <div className="telemetry-panel-header">
        <div>
          <span>Inferred movement</span>
          <strong>{sessionTelemetry.movementType ? movementDefinition.label : 'Observing'}</strong>
          <small>
            {liveState.label} / {status}
          </small>
        </div>
        <TelemetryModeControl value={telemetryMode} onChange={onTelemetryModeChange} />
      </div>

      <div className="rep-counter telemetry-block">
        <div>
          <span>{repCountTelemetryLabel(movementDefinition)}</span>
          <strong>{detectorState.validReps}</strong>
          <small>{detectorState.partialReps} partial reps</small>
        </div>
        <SignalDial value={telemetrySignal} phase={detectorState.phase} />
      </div>

      <div className="metric-grid telemetry-block">
        <Metric label="Session state" value={formatSessionMode(sessionTelemetry.mode)} />
        <Metric
          label="Activity"
          value={formatActivityState(sessionTelemetry.activityState ?? 'idle')}
        />
        <Metric
          label="Recognition"
          value={formatMetric(sessionTelemetry.recognitionConfidence, '%')}
        />
        <Metric
          label="Activity confidence"
          value={formatMetric(sessionTelemetry.activityConfidence, '%')}
        />
        <Metric label="Movement state" value={liveState.label} />
        <Metric label="State detail" value={liveState.detail} />
        <Metric label="Capture" value={formatCameraStreamInfo(cameraStreamInfo)} />
        {telemetryMetrics.map((metric) => (
          <Metric key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>

      {(primaryGuidanceFor(sessionTelemetry) ?? sessionTelemetry.cameraAdvice) ? (
        <div
          className="camera-advice telemetry-block"
          data-severity={
            primaryGuidanceFor(sessionTelemetry)?.severity ??
            sessionTelemetry.cameraAdvice?.severity
          }
        >
          <span>
            {primaryGuidanceFor(sessionTelemetry)?.title ?? sessionTelemetry.cameraAdvice?.title}
          </span>
          <p>
            {primaryGuidanceFor(sessionTelemetry)?.message ??
              sessionTelemetry.cameraAdvice?.message}
          </p>
        </div>
      ) : null}

      <div className="form-feedback telemetry-block">
        <span>Analysis guidance</span>
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
  const liveState = liveTelemetryStateFor(detectorState, sessionTelemetry);
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
        <span>Inferred movement</span>
        <strong>{sessionTelemetry.movementType ? movementDefinition.label : 'Observing'}</strong>
        <small>
          {liveState.label} / {status}
        </small>
      </div>

      <dl className="mirror-telemetry-readout">
        <div className="mirror-primary-metric">
          <dt>{repCountTelemetryLabel(movementDefinition)}</dt>
          <dd>{detectorState.validReps}</dd>
        </div>
        <div>
          <dt>Partial</dt>
          <dd>{detectorState.partialReps}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{liveState.label}</dd>
        </div>
        <div>
          <dt>Detail</dt>
          <dd>{liveState.detail}</dd>
        </div>
        {telemetryMetrics.slice(0, 3).map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
        <div>
          <dt>Signal</dt>
          <dd>{formatMetric(sessionTelemetry.recognitionConfidence, '%')}</dd>
        </div>
      </dl>

      <p className="mirror-form-message">
        {primaryGuidanceFor(sessionTelemetry)?.message ??
          sessionTelemetry.cameraAdvice?.message ??
          formMessage}
      </p>
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const chartModel = buildHistoryChartModel(sessions);
  const selectedSession = selectedHistorySession(sessions, selectedSessionId);
  const selectedSessionFatigue = selectedSession
    ? buildSessionFatigueModel(selectedSession)
    : undefined;
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
                <button
                  aria-pressed={session.id === selectedSession?.id}
                  className={`history-table-row history-table-button${
                    session.id === selectedSession?.id ? ' is-selected' : ''
                  }`}
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  type="button"
                >
                  <div>
                    <strong>{formatCompactDate(session.startedAt)}</strong>
                    <small>{formatCompactTime(session.startedAt)}</small>
                  </div>
                  <span>{formatDuration(session.durationSeconds ?? 0)}</span>
                  <span>{formatSessionMovementNames(session)}</span>
                  <span>{sessionTotalReps(session)}</span>
                  <span>{formatQualityScore(sessionAverageQuality(session))}</span>
                  <span>{sessionWarningCount(session)}</span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <aside className="history-detail-panel" aria-label="Session details">
        {selectedSession ? (
          <>
            <section className="history-detail-card session-detail-hero">
              <span>Session details</span>
              <strong>{formatDate(selectedSession.startedAt)}</strong>
              <div>
                <small>{formatSessionMovementSummary(selectedSession)}</small>
                <b>{formatDuration(selectedSession.durationSeconds ?? 0)}</b>
              </div>
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Session flow</span>
                  <h2>Movement mix</h2>
                </div>
                <small>{selectedSession.movements.length} sets</small>
              </div>

              {selectedSession.movements.length === 0 ? (
                <div className="history-empty-line">No movement flow recorded.</div>
              ) : (
                <div className="session-flow-map" aria-label="Session movement sequence">
                  {selectedSession.movements.map((movement, index) => (
                    <div className="session-flow-node" key={movement.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{movementDefinitionFor(movement.movementType).label}</strong>
                      <small>
                        {movement.reps} reps / {formatMovementDuration(movement)}
                      </small>
                    </div>
                  ))}
                </div>
              )}

              {sessionTransitionEvents(selectedSession).length > 0 ? (
                <div className="session-transition-list" aria-label="Movement transitions">
                  {sessionTransitionEvents(selectedSession).map((event) => (
                    <span key={event.id}>
                      {formatCompactTime(event.timestamp)} /{' '}
                      {event.competingMovementTypes
                        ?.map((movementType) => movementDefinitionFor(movementType).label)
                        .join(' -> ') ?? 'transition'}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Movement breakdown</span>
                  <h2>Movement segments</h2>
                </div>
              </div>

              {selectedSession.movements.length === 0 ? (
                <div className="history-empty-line">No movement segments recorded.</div>
              ) : (
                <div className="movement-breakdown-list">
                  {selectedSession.movements.map((movement) => {
                    const definition = movementDefinitionFor(movement.movementType);
                    const primaryGuidance = movement.guidanceEvents?.find(
                      (event) => event.code !== 'conditions_usable',
                    );
                    const quality = movementQualityBreakdown(movement);
                    const warningEntries = Object.entries(movement.setSummary?.warningCounts ?? {});

                    return (
                      <div className="movement-breakdown-item" key={movement.id}>
                        <div className="movement-breakdown-summary">
                          <div>
                            <strong>{definition.label}</strong>
                            <small>{formatCameraAngle(movement.cameraAngle)}</small>
                          </div>
                          <span>{formatMovementSegmentState(movement)}</span>
                        </div>

                        {primaryGuidance ? (
                          <p className="movement-breakdown-guidance">{primaryGuidance.title}</p>
                        ) : null}

                        <div className="movement-breakdown-metrics" aria-label="Movement totals">
                          <div>
                            <small>Valid</small>
                            <span>{movement.validReps}</span>
                          </div>
                          <div>
                            <small>Partial</small>
                            <span>{movement.partialReps}</span>
                          </div>
                          <div>
                            <small>Quality</small>
                            <span>{formatQualityScore(averageMovementQuality(movement))}</span>
                          </div>
                        </div>

                        <div
                          className="movement-set-detail-grid"
                          aria-label={`${definition.label} set quality and timing`}
                        >
                          <div>
                            <small>Range</small>
                            <span>{formatMetric(quality.rangeScore, '%')}</span>
                          </div>
                          <div>
                            <small>Alignment</small>
                            <span>{formatMetric(quality.alignmentScore, '%')}</span>
                          </div>
                          <div>
                            <small>Rhythm</small>
                            <span>{formatMetric(quality.rhythmScore, '%')}</span>
                          </div>
                          <div>
                            <small>Signal</small>
                            <span>
                              {formatMetric(
                                movement.setSummary?.averageConfidence ?? quality.confidenceScore,
                                '%',
                              )}
                            </span>
                          </div>
                          <div>
                            <small>Cadence</small>
                            <span>
                              {formatSecondsValue(movement.setSummary?.averageCadenceSeconds)}
                            </span>
                          </div>
                          <div>
                            <small>Rest</small>
                            <span>{formatRestWindow(movement)}</span>
                          </div>
                        </div>

                        {warningEntries.length > 0 ? (
                          <div className="movement-warning-chips" aria-label="Warning counts">
                            {warningEntries.map(([code, count]) => (
                              <span key={code}>
                                {formatCodeLabel(code)} x{count}
                              </span>
                            ))}
                          </div>
                        ) : null}
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
                <Metric label="Valid reps" value={String(sessionValidReps(selectedSession))} />
                <Metric label="Partial reps" value={String(sessionPartialReps(selectedSession))} />
                <Metric
                  label="Avg quality"
                  value={formatQualityScore(sessionAverageQuality(selectedSession))}
                />
                <Metric
                  label="Avg signal"
                  value={formatMetric(sessionAverageRecognitionConfidence(selectedSession), '%')}
                />
                <Metric label="Warnings" value={String(sessionWarningCount(selectedSession))} />
                <Metric label="Guidance" value={String(sessionGuidanceCount(selectedSession))} />
              </div>
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Tracking quality</span>
                  <h2>Camera and calibration</h2>
                </div>
              </div>

              <div className="detail-metric-grid">
                <Metric label="Camera angles" value={formatSessionCameraAngles(selectedSession)} />
                <Metric
                  label="Tracking gaps"
                  value={String(sessionTimelineCount(selectedSession, 'tracking_lost'))}
                />
                <Metric
                  label="Recovered"
                  value={String(sessionTimelineCount(selectedSession, 'tracking_recovered'))}
                />
                <Metric
                  label="Camera guidance"
                  value={String(sessionTimelineCount(selectedSession, 'camera_guidance'))}
                />
              </div>

              {sessionCameraGuidanceMessages(selectedSession).length > 0 ? (
                <div className="tracking-quality-list" aria-label="Camera guidance history">
                  {sessionCameraGuidanceMessages(selectedSession).map((message) => (
                    <span key={message}>{message}</span>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Fatigue trend</span>
                  <h2>Session degradation</h2>
                </div>
                <small>
                  {selectedSessionFatigue
                    ? `${formatMetric(selectedSessionFatigue.sessionFatigueScore, '%')} load / ${selectedSessionFatigue.confidenceTrend}`
                    : 'n/a'}
                </small>
              </div>

              {!selectedSessionFatigue || selectedSessionFatigue.points.length === 0 ? (
                <div className="history-empty-line">No fatigue telemetry recorded.</div>
              ) : (
                <div className="fatigue-timeline">
                  {selectedSessionFatigue.points.map((point) => (
                    <div key={point.id} className="fatigue-timeline-row">
                      <div>
                        <strong>{point.label}</strong>
                        <span>{point.movementLabel}</span>
                      </div>
                      <div className="fatigue-bars" aria-hidden="true">
                        <i
                          className="fatigue-bar-load"
                          style={
                            {
                              '--fatigue': `${Math.round(point.fatigueScore * 100)}%`,
                            } as CSSProperties
                          }
                        />
                        <i
                          className="fatigue-bar-signal"
                          style={
                            {
                              '--signal': `${Math.round((point.confidenceScore ?? 0) * 100)}%`,
                            } as CSSProperties
                          }
                        />
                      </div>
                      <dl>
                        <div>
                          <dt>load</dt>
                          <dd>{formatMetric(point.fatigueScore, '%')}</dd>
                        </div>
                        <div>
                          <dt>signal</dt>
                          <dd>{formatMetric(point.confidenceScore, '%')}</dd>
                        </div>
                        <div>
                          <dt>alerts</dt>
                          <dd>{point.warningCount + point.guidanceCount}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="history-detail-card">
              <div className="history-section-heading">
                <div>
                  <span>Segment telemetry</span>
                  <h2>Latest movement signals</h2>
                </div>
              </div>

              {selectedSession.movements.length === 0 ? (
                <div className="history-empty-line">No movement telemetry recorded.</div>
              ) : (
                <div className="segment-telemetry-list">
                  {selectedSession.movements.map((movement) => (
                    <div key={movement.id}>
                      <strong>{movementDefinitionFor(movement.movementType).label}</strong>
                      <dl>
                        {movementTelemetryEntries(movement).map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              )}
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
  telemetryMode,
  onTelemetryModeChange,
  sessions,
  summary,
  onHistoryChanged,
  preferences,
  onPreferencesChange,
}: {
  readonly platform: ActivityPlatform;
  readonly startupEnabled: boolean;
  readonly onStartupEnabledChange: (enabled: boolean) => void;
  readonly themePreference: ThemePreference;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
  readonly telemetryMode: TelemetryMode;
  readonly onTelemetryModeChange: (mode: TelemetryMode) => void;
  readonly sessions: readonly ActivitySession[];
  readonly summary: ActivitySummary;
  readonly onHistoryChanged: () => Promise<void>;
  readonly preferences: AppSettingsPreferences;
  readonly onPreferencesChange: (preferences: AppSettingsPreferences) => void;
}): ReactElement {
  const [reminderStatus, setReminderStatus] = useState('No reminder sent this session.');
  const [cameraStatus, setCameraStatus] = useState('Camera access has not been checked here.');
  const [dataStatus, setDataStatus] = useState('Local data controls are ready.');
  const [confirmClearSessions, setConfirmClearSessions] = useState(false);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<readonly MediaDeviceInfo[]>([]);
  const [storageInfo, setStorageInfo] = useState<HistoryStorageInfo>({
    bytes: 0,
    sessionCount: sessions.length,
    locationLabel: 'Local device',
    poseTraceLocationLabel: 'Not checked',
    benchmarkReportLocationLabel: 'Not checked',
    lastActivityAt: summary.lastActivityAt,
  });
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const canUseStartup = Boolean(platform.settings);
  const canUseNotifications = Boolean(platform.notifications);
  const canCheckCamera = Boolean(platform.cameraPermission);
  const canEnumerateCameras = Boolean(navigator.mediaDevices?.enumerateDevices);

  const refreshStorageInfo = useCallback(async () => {
    setStorageInfo(await platform.history.storageInfo());
  }, [platform.history]);

  useEffect(() => {
    void refreshStorageInfo();
  }, [refreshStorageInfo, sessions]);

  const updatePreference = <Key extends keyof AppSettingsPreferences>(
    key: Key,
    value: AppSettingsPreferences[Key],
  ): void => {
    onPreferencesChange({
      ...preferences,
      [key]: value,
    });
  };

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCameraStatus('Camera device enumeration is not available in this runtime.');
      return;
    }

    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'videoinput',
    );
    setCameraDevices(devices);

    if (
      preferences.cameraDeviceId &&
      !devices.some((device) => device.deviceId === preferences.cameraDeviceId)
    ) {
      onPreferencesChange({ ...preferences, cameraDeviceId: undefined });
    }

    setCameraStatus(
      devices.length > 0
        ? `Detected ${devices.length} camera${devices.length === 1 ? '' : 's'}.`
        : 'No camera devices were detected.',
    );
  }, [onPreferencesChange, preferences]);

  useEffect(() => {
    void refreshCameraDevices();
  }, [refreshCameraDevices]);

  const toggleStartup = async (enabled: boolean) => {
    await platform.settings?.setStartupEnabled(enabled);
    onStartupEnabledChange(enabled);
  };

  const checkCameraAccess = async (): Promise<void> => {
    setCameraStatus('Checking camera permission...');
    const permission = await platform.cameraPermission?.ensureCameraPermission();
    setCameraStatus(
      permission?.granted
        ? 'Camera access is available for this app.'
        : (permission?.reason ?? 'Camera permission could not be verified.'),
    );
    await refreshCameraDevices();
  };

  const exportSessionData = async (): Promise<void> => {
    const exportedSessions = await platform.history.list();
    const payload = JSON.stringify(
      {
        ...persistedActivityHistory(exportedSessions),
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `camchad-session-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setDataStatus(`Exported ${exportedSessions.length} local sessions.`);
  };

  const importSessionData = async (file: File): Promise<void> => {
    const parsed = JSON.parse(await file.text()) as unknown;
    const importedHistory = normalizeActivityHistory(parsed);
    const importedSessions = importedHistory.sessions;

    if (importedSessions.length === 0) {
      setDataStatus('No supported CamChad v1 sessions were found in that backup.');
      return;
    }

    const mergeSummary = await platform.history.merge(importedSessions);
    await onHistoryChanged();
    await refreshStorageInfo();
    setDataStatus(
      `Merged ${mergeSummary.importedSessions} imported sessions: ${mergeSummary.addedSessions} added, ${mergeSummary.updatedSessions} updated, ${mergeSummary.unchangedSessions} unchanged. ${mergeSummary.totalSessions} sessions stored locally.`,
    );
  };

  const clearAllSessions = async (): Promise<void> => {
    await platform.history.clear();
    setConfirmClearSessions(false);
    setConfirmClearCache(false);
    await onHistoryChanged();
    await refreshStorageInfo();
    setDataStatus('All local session history has been cleared.');
  };

  const clearInterfaceCache = (): void => {
    try {
      localStorage.removeItem(settingsPreferencesStorageKey);
      localStorage.removeItem(telemetryModeStorageKey);
      onPreferencesChange(defaultSettingsPreferences);
      onTelemetryModeChange('fixed');
      setConfirmClearSessions(false);
      setConfirmClearCache(false);
      setDataStatus('Interface preferences and cached UI state have been reset.');
    } catch {
      setDataStatus('Interface cache could not be reset in this environment.');
    }
  };

  const cameraDeviceOptions: readonly (readonly [string, string])[] = [
    ['default', 'System default'],
    ...cameraDevices.map(
      (device, index) => [device.deviceId, device.label || `Camera ${index + 1}`] as const,
    ),
  ];

  return (
    <section className="settings-command-center">
      <div className="settings-primary-column">
        <div className="settings-heading-row">
          <div className="page-heading settings-page-heading">
            <div>
              <span>Instrument control</span>
              <h1>Settings</h1>
              <p>
                Configure the local movement engine, camera guidance, telemetry, and data controls.
              </p>
            </div>
          </div>

          <div className="history-window-badge settings-header-badge">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Local only</span>
          </div>
        </div>

        <SettingsSection
          icon={<Camera size={20} aria-hidden="true" />}
          title="Camera Settings"
          description="Tune capture assumptions and check whether this app can access the camera."
        >
          <SettingsRow
            label="Camera source"
            description={
              canEnumerateCameras
                ? 'Choose which local camera the Activity view should request.'
                : 'Camera selection is not available in this runtime.'
            }
          >
            <SettingsSelect
              value={preferences.cameraDeviceId ?? 'default'}
              disabled={!canEnumerateCameras}
              onChange={(value) =>
                updatePreference('cameraDeviceId', value === 'default' ? undefined : value)
              }
              options={cameraDeviceOptions}
            />
          </SettingsRow>
          <SettingsRow
            label="Resolution"
            description="Higher capture targets can improve analysis detail."
          >
            <SettingsSelect
              value={preferences.cameraResolution}
              onChange={(value) =>
                updatePreference('cameraResolution', value as SettingsResolution)
              }
              options={[
                ['auto', 'Auto'],
                ['720p', '1280 x 720'],
                ['1080p', '1920 x 1080'],
              ]}
            />
          </SettingsRow>
          <SettingsRow label="Frame rate" description="30 FPS is stable for most local analysis.">
            <SettingsSelect
              value={preferences.cameraFrameRate}
              onChange={(value) => updatePreference('cameraFrameRate', value as SettingsFrameRate)}
              options={[
                ['30', '30 FPS'],
                ['60', '60 FPS'],
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="Mirror preview"
            description="Flip the live preview to match mirror behavior."
          >
            <SettingsToggle
              checked={preferences.cameraMirror}
              onChange={(checked) => updatePreference('cameraMirror', checked)}
            />
          </SettingsRow>
          <SettingsRow
            label="Default camera view"
            description="Start from a natural front-facing view, then surface angle guidance per movement."
          >
            <SettingsSelect
              value={preferences.cameraPositionGuide}
              onChange={(value) =>
                updatePreference('cameraPositionGuide', value as SettingsPositionGuide)
              }
              options={[
                ['auto', 'Default camera view'],
                ['side', 'Prioritize side view'],
                ['front', 'Prioritize front view'],
              ]}
            />
          </SettingsRow>
          <SettingsActionRow
            label="Camera access"
            description={cameraStatus}
            actionLabel="Check access"
            icon={<RadioTower size={16} aria-hidden="true" />}
            disabled={!canCheckCamera}
            onAction={() => void checkCameraAccess()}
          />
          <SettingsActionRow
            label="Device list"
            description="Refresh available local video inputs after connecting or disconnecting a camera."
            actionLabel="Refresh"
            icon={<RadioTower size={16} aria-hidden="true" />}
            variant="secondary"
            disabled={!canEnumerateCameras}
            onAction={() => void refreshCameraDevices()}
          />
          <SettingsCapabilityRow
            label="Low-light detection"
            description="Engine diagnostics already react to low signal confidence; dedicated lighting classification is not implemented yet."
          />
        </SettingsSection>

        <SettingsSection
          icon={<ScanLine size={20} aria-hidden="true" />}
          title="Skeleton Visualization"
          description="Control the pose overlay used for movement feedback and debugging."
        >
          <SettingsRow
            label="Show skeleton"
            description="Render tracked joints and segment lines on the feed."
          >
            <SettingsToggle
              checked={preferences.skeletonVisible}
              onChange={(checked) => updatePreference('skeletonVisible', checked)}
            />
          </SettingsRow>
          <SettingsCapabilityRow
            label="Skeleton styling controls"
            description="Planned. The runtime currently exposes one production overlay; line style, joint density, and confidence-color controls need renderer support before they become settings."
          />
          <SettingsCapabilityRow
            label="Diagnostic overlay"
            description="Planned. Developer diagnostics should expose body-state and confidence internals without pretending to be a user-facing toggle today."
          />
        </SettingsSection>

        <SettingsSection
          icon={<Gauge size={20} aria-hidden="true" />}
          title="Telemetry Display"
          description="Shape how live movement instrumentation appears during a session."
        >
          <SettingsRow
            label="Telemetry mode"
            description="Use a fixed sidebar or engraved mirror telemetry."
          >
            <SegmentedSetting
              value={telemetryMode}
              onChange={(value) => onTelemetryModeChange(value as TelemetryMode)}
              options={[
                ['fixed', 'Sidebar'],
                ['engraved', 'Mirror HUD'],
              ]}
            />
          </SettingsRow>
          <SettingsRow
            label="Overlay opacity"
            description="Balance readability against the live preview."
          >
            <SettingsRange
              value={preferences.telemetryOpacity}
              min={55}
              max={100}
              unit="%"
              onChange={(value) => updatePreference('telemetryOpacity', value)}
            />
          </SettingsRow>
          <SettingsRow
            label="Overlay blur"
            description="Tune the frosted HUD separation in overlay contexts."
          >
            <SettingsRange
              value={preferences.telemetryBlur}
              min={0}
              max={24}
              unit="px"
              onChange={(value) => updatePreference('telemetryBlur', value)}
            />
          </SettingsRow>
          <SettingsCapabilityRow
            label="HUD density and metric selection"
            description="Planned. The telemetry panels currently render engine-selected metrics; user-selected density needs a real metric visibility model first."
          />
          <SettingsCapabilityRow
            label="Feedback verbosity"
            description="Planned. Guidance is prioritized by actionability today; adjustable verbosity should be wired through the guidance priority model before exposure."
          />
        </SettingsSection>

        <SettingsSection
          icon={<ShieldCheck size={20} aria-hidden="true" />}
          title="Data & Privacy Management"
          description="Manage local sessions, backups, cache, and OS-level behavior without cloud dependency."
        >
          <SettingsRow
            label="Auto-save sessions"
            description="Persist movement sessions automatically when recordable activity is detected."
          >
            <SettingsToggle
              checked={preferences.autoSaveSessions}
              onChange={(checked) => updatePreference('autoSaveSessions', checked)}
            />
          </SettingsRow>
          <SettingsActionRow
            label="Export session data"
            description="Download a readable JSON backup of the local session log."
            actionLabel="Export"
            icon={<Download size={16} aria-hidden="true" />}
            onAction={() => void exportSessionData()}
          />
          <SettingsActionRow
            label="Import backup"
            description="Merge a CamChad JSON export into existing local sessions after validation."
            actionLabel="Import"
            icon={<Upload size={16} aria-hidden="true" />}
            onAction={() => importInputRef.current?.click()}
          />
          <input
            ref={importInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';

              if (file) {
                void importSessionData(file);
              }
            }}
          />
          <SettingsActionRow
            label="Clear analytics cache"
            description={
              confirmClearCache
                ? 'Confirm reset. This clears interface preferences and cached display state, but keeps saved sessions.'
                : 'Reset interface preferences and cached display state without deleting sessions.'
            }
            actionLabel={confirmClearCache ? 'Confirm reset' : 'Reset cache'}
            icon={<Trash2 size={16} aria-hidden="true" />}
            variant="secondary"
            onAction={() => {
              if (confirmClearCache) {
                clearInterfaceCache();
              } else {
                setConfirmClearCache(true);
                setConfirmClearSessions(false);
              }
            }}
          />
          <SettingsActionRow
            label="Clear all sessions"
            description={
              confirmClearSessions
                ? `Confirm deletion. This removes ${storageInfo.sessionCount} locally saved session${
                    storageInfo.sessionCount === 1 ? '' : 's'
                  } from this device.`
                : 'Remove every saved local session. Export a backup first if you need one.'
            }
            actionLabel={confirmClearSessions ? 'Confirm clear' : 'Clear sessions'}
            icon={<Trash2 size={16} aria-hidden="true" />}
            variant="danger"
            onAction={() => {
              if (confirmClearSessions) {
                void clearAllSessions();
              } else {
                setConfirmClearSessions(true);
                setConfirmClearCache(false);
              }
            }}
          />
          <SettingsRow
            label="Open on login"
            description="Start the desktop app when your computer boots."
          >
            <SettingsToggle
              checked={startupEnabled}
              disabled={!canUseStartup}
              onChange={(checked) => void toggleStartup(checked)}
            />
          </SettingsRow>
          <SettingsActionRow
            label="Reminder test"
            description={reminderStatus}
            actionLabel="Send"
            icon={<Bell size={16} aria-hidden="true" />}
            disabled={!canUseNotifications}
            onAction={() => {
              void platform.notifications?.activityReminder('Time for a short movement session.');
              setReminderStatus('Reminder sent locally through the operating system.');
            }}
          />
        </SettingsSection>
      </div>

      <aside className="settings-preview-column">
        <section className="settings-preview-card">
          <div className="settings-preview-heading">
            <span>Theme</span>
            <strong>Interface tone</strong>
          </div>
          <ThemeSegmentedControl value={themePreference} onChange={onThemePreferenceChange} />
          <SettingsInterfacePreview
            preferences={preferences}
            telemetryMode={telemetryMode}
            themePreference={themePreference}
          />
        </section>

        <section className="settings-preview-card">
          <div className="settings-preview-heading">
            <span>Tracking readiness</span>
            <strong>Camera guidance</strong>
          </div>
          <div className="guidance-panel">
            <div>
              <Camera size={18} aria-hidden="true" />
              <span>{cameraStatus}</span>
            </div>
            <p>
              Keep the full body inside frame, prefer stable lighting, and let automatic movement
              recognition settle for a few seconds before judging telemetry quality.
            </p>
          </div>
        </section>

        <section className="settings-preview-card">
          <div className="settings-preview-heading">
            <span>Local data</span>
            <strong>On-device storage</strong>
          </div>
          <div className="settings-storage-grid">
            <Metric label="Sessions" value={String(storageInfo.sessionCount)} />
            <Metric label="Storage" value={formatBytes(storageInfo.bytes)} />
            <Metric label="Total reps" value={String(summary.totalReps)} />
            <Metric
              label="Last activity"
              value={
                storageInfo.lastActivityAt ? formatCompactDate(storageInfo.lastActivityAt) : 'None'
              }
            />
          </div>
          <p className="settings-storage-note">
            All session data stays on this device. No account, server sync, cloud model upload, or
            remote analytics pipeline is used.
          </p>
          <div className="settings-storage-locations" aria-label="Local storage locations">
            <div>
              <span>History</span>
              <strong>{storageInfo.locationLabel}</strong>
            </div>
            <div>
              <span>Pose traces</span>
              <strong>{storageInfo.poseTraceLocationLabel ?? 'Not enabled'}</strong>
            </div>
            <div>
              <span>Benchmark reports</span>
              <strong>{storageInfo.benchmarkReportLocationLabel ?? 'Not enabled'}</strong>
            </div>
          </div>
          <p className="setting-note">{dataStatus}</p>
        </section>
      </aside>
    </section>
  );
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  readonly icon: ReactElement;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="settings-section">
      <header className="settings-section-header">
        <div className="settings-section-icon">{icon}</div>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="settings-control-row">
      <div className="settings-control-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="settings-control-value">{children}</div>
    </div>
  );
}

function SettingsActionRow({
  label,
  description,
  actionLabel,
  icon,
  onAction,
  disabled = false,
  variant = 'primary',
}: {
  readonly label: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly icon: ReactElement;
  readonly onAction: () => void;
  readonly disabled?: boolean;
  readonly variant?: 'primary' | 'secondary' | 'danger';
}): ReactElement {
  return (
    <SettingsRow label={label} description={description}>
      <button
        className={`settings-action-button settings-action-${variant}`}
        type="button"
        disabled={disabled}
        onClick={onAction}
      >
        {icon}
        <span>{actionLabel}</span>
      </button>
    </SettingsRow>
  );
}

function SettingsCapabilityRow({
  label,
  description,
}: {
  readonly label: string;
  readonly description: string;
}): ReactElement {
  return (
    <SettingsRow label={label} description={description}>
      <span className="settings-state-pill">Planned</span>
    </SettingsRow>
  );
}

function SettingsToggle({
  checked,
  onChange,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}): ReactElement {
  return (
    <button
      className="settings-toggle"
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function SettingsSelect({
  value,
  options,
  onChange,
  disabled = false,
}: {
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}): ReactElement {
  return (
    <select
      className="settings-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

function SettingsRange({
  value,
  min,
  max,
  unit,
  onChange,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly onChange: (value: number) => void;
}): ReactElement {
  return (
    <div className="settings-range">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span>
        {value}
        {unit}
      </span>
    </div>
  );
}

function SegmentedSetting({
  value,
  options,
  onChange,
}: {
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className="settings-segmented-control">
      {options.map(([optionValue, label]) => (
        <button
          key={optionValue}
          type="button"
          aria-pressed={value === optionValue}
          onClick={() => onChange(optionValue)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SettingsInterfacePreview({
  preferences,
  telemetryMode,
  themePreference,
}: {
  readonly preferences: AppSettingsPreferences;
  readonly telemetryMode: TelemetryMode;
  readonly themePreference: ThemePreference;
}): ReactElement {
  const bodyPreviewClass = preferences.skeletonVisible
    ? 'settings-body-preview'
    : 'settings-body-preview is-hidden';

  return (
    <div
      className="settings-interface-preview"
      data-theme-preview={themePreference}
      style={
        {
          '--preview-hud-opacity': `${preferences.telemetryOpacity / 100}`,
          '--preview-hud-blur': `${preferences.telemetryBlur}px`,
        } as CSSProperties
      }
    >
      <div className="settings-preview-sidebar">
        <i />
        <i />
        <i />
      </div>
      <div className="settings-preview-stage">
        <span>Live feed</span>
        <div className={bodyPreviewClass}>
          <img src="/settings/human-body-preview.webp" alt="" aria-hidden="true" />
        </div>
      </div>
      <div className={`settings-preview-telemetry mode-${telemetryMode}`}>
        <small>{telemetryMode === 'fixed' ? 'Sidebar telemetry' : 'Mirror HUD'}</small>
        <strong>{preferences.telemetryOpacity}% opacity</strong>
        <span>{preferences.telemetryBlur}px blur</span>
      </div>
    </div>
  );
}

function SupportedExercisesView({
  exerciseGuideAssetBasePath,
  selectedMovementType,
  onSelectedMovementTypeChange,
}: {
  readonly exerciseGuideAssetBasePath: string;
  readonly selectedMovementType: MovementType | undefined;
  readonly onSelectedMovementTypeChange: (movementType: MovementType) => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ExerciseCatalogFilter>('all');
  const implementedDefinitions = movementRegistry.filter(
    (definition) => definition.maturity !== 'planned',
  );
  const selectedDefinition =
    movementRegistry.find((definition) => definition.type === selectedMovementType) ??
    movementRegistry[0];
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDefinitions = movementRegistry.filter((definition) => {
    const matchesFilter =
      filter === 'all' || definition.maturity === filter || definition.category === filter;
    const matchesQuery =
      normalizedQuery.length === 0 ||
      definition.label.toLowerCase().includes(normalizedQuery) ||
      definition.bodyOrientation.toLowerCase().includes(normalizedQuery) ||
      definition.analysisSignals.some((signal) => signal.toLowerCase().includes(normalizedQuery));

    return matchesFilter && matchesQuery;
  });
  const visibleDefinitions = [...filteredDefinitions].sort(compareMovementDefinitionsForCatalog);
  const filterCount = (catalogFilter: ExerciseCatalogFilter): number =>
    movementRegistry.filter(
      (definition) =>
        catalogFilter === 'all' ||
        definition.maturity === catalogFilter ||
        definition.category === catalogFilter,
    ).length;
  const activeCoverage = Math.round(
    (implementedDefinitions.length / movementRegistry.length) * 100,
  );

  return (
    <section className="exercise-observatory">
      <div className="exercise-library-column">
        <div className="exercise-heading-row">
          <div className="page-heading exercise-page-heading">
            <div>
              <span>Exercise library</span>
              <h1>Movement Profiles</h1>
              <p>
                Browse the local movement profiles CamChad can detect, recognize, count, validate,
                or keep as planned definitions for future tracking.
              </p>
            </div>
          </div>

          <div className="history-window-badge exercise-header-badge">
            <Cpu size={16} aria-hidden="true" />
            <span>{activeCoverage}% active coverage</span>
          </div>
        </div>

        <section className="exercise-system-strip" aria-label="Movement engine status">
          {movementMaturityStates.map((state) => (
            <div key={state.value} data-maturity={state.value}>
              <span>{state.label}</span>
              <strong>{filterCount(state.value)}</strong>
              <small>{state.description}</small>
            </div>
          ))}
        </section>

        <section className="exercise-definition-panel" aria-labelledby="exercise-catalog-title">
          <div className="exercise-catalog-header">
            <div className="exercise-panel-heading">
              <div>
                <span>Exercise catalog</span>
                <h2 id="exercise-catalog-title">Available profiles</h2>
              </div>
              <small>
                Showing {visibleDefinitions.length} of {movementRegistry.length}
              </small>
            </div>

            <div className="exercise-search-cluster">
              <label className="exercise-search">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder="Search name, signal, or orientation..."
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                className="exercise-filter-button"
                type="button"
                disabled={filter === 'all' && query.length === 0}
                onClick={() => {
                  setFilter('all');
                  setQuery('');
                }}
              >
                <Filter size={16} aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>

          <div className="exercise-filter-pills" aria-label="Filter exercise catalog">
            <ExerciseFilterPill
              value="all"
              count={filterCount('all')}
              activeFilter={filter}
              onChange={setFilter}
            >
              All
            </ExerciseFilterPill>
            {movementMaturityStates.map((state) => (
              <ExerciseFilterPill
                key={state.value}
                value={state.value}
                count={filterCount(state.value)}
                activeFilter={filter}
                onChange={setFilter}
              >
                {state.shortLabel}
              </ExerciseFilterPill>
            ))}
            <ExerciseFilterPill
              value="repetition"
              count={filterCount('repetition')}
              activeFilter={filter}
              onChange={setFilter}
            >
              Repetition
            </ExerciseFilterPill>
            <ExerciseFilterPill
              value="hold"
              count={filterCount('hold')}
              activeFilter={filter}
              onChange={setFilter}
            >
              Holds
            </ExerciseFilterPill>
            <ExerciseFilterPill
              value="compound"
              count={filterCount('compound')}
              activeFilter={filter}
              onChange={setFilter}
            >
              Compound
            </ExerciseFilterPill>
          </div>

          <div className="engine-definition-grid">
            {visibleDefinitions.length === 0 ? (
              <div className="engine-definition-empty">
                No movement definitions match the current search and filter state.
              </div>
            ) : (
              visibleDefinitions.map((definition) => (
                <EngineDefinitionRow
                  definition={definition}
                  exerciseGuideAssetBasePath={exerciseGuideAssetBasePath}
                  isSelected={definition.type === selectedDefinition.type}
                  key={definition.type}
                  onSelect={() => onSelectedMovementTypeChange(definition.type)}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <MovementDefinitionInspector
        definition={selectedDefinition}
        exerciseGuideAssetBasePath={exerciseGuideAssetBasePath}
      />
    </section>
  );
}

function ExerciseFilterPill({
  value,
  count,
  activeFilter,
  onChange,
  children,
}: {
  readonly value: ExerciseCatalogFilter;
  readonly count: number;
  readonly activeFilter: ExerciseCatalogFilter;
  readonly onChange: (value: ExerciseCatalogFilter) => void;
  readonly children: string;
}): ReactElement {
  return (
    <button type="button" aria-pressed={activeFilter === value} onClick={() => onChange(value)}>
      <span>{children}</span>
      <strong>{count}</strong>
    </button>
  );
}

function EngineDefinitionRow({
  definition,
  exerciseGuideAssetBasePath,
  isSelected,
  onSelect,
}: {
  readonly definition: MovementDefinition;
  readonly exerciseGuideAssetBasePath: string;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  const guide = exerciseGuideFor(definition.type, exerciseGuideAssetBasePath);
  const maturityScore = movementMaturityScore(definition);
  const telemetryRichness = movementTelemetryRichness(definition);
  const planningPriority = movementPlanningPriority(definition);

  return (
    <button
      className="engine-definition-card"
      data-maturity={definition.maturity}
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <MovementPreviewFrame definition={definition} guide={guide} />
      <div className="engine-definition-copy">
        <div className="engine-definition-title-row">
          <strong>{definition.label}</strong>
          <span>{formatMaturityLevel(definition.maturity)}</span>
        </div>
        <p>{movementDefinitionSummary(definition)}</p>
        <div className="engine-definition-tags">
          <span>{formatMovementCategory(definition.category)}</span>
          <span>{formatBodyOrientation(definition.bodyOrientation)}</span>
          <span>{formatCameraAngle(definition.defaultCameraAngle)}</span>
          <span>{definition.analysisSignals.length} signals</span>
        </div>
      </div>
      <div className="engine-definition-card-footer">
        <div className="engine-definition-score">
          <div className="mini-signal-ring" style={{ '--score': maturityScore } as CSSProperties}>
            <span>{maturityScore}%</span>
          </div>
          <small>Maturity</small>
        </div>
        <div className="engine-definition-metadata">
          <span>{telemetryRichness}% telemetry</span>
          <span>{definition.supportedCameraAngles.length} camera angles</span>
          <span>
            {definition.maturity === 'planned'
              ? `${planningPriority.label} priority`
              : movementComplexityLabel(definition)}
          </span>
        </div>
      </div>
    </button>
  );
}

function MovementPreviewFrame({
  definition,
  guide,
}: {
  readonly definition: MovementDefinition;
  readonly guide: ExerciseGuide | undefined;
}): ReactElement {
  return (
    <div className="movement-preview-frame" data-maturity={definition.maturity}>
      {guide ? (
        <img src={guide.src} alt="" loading="lazy" />
      ) : (
        <div className="movement-preview-unavailable">
          <span>Guide pending</span>
        </div>
      )}
      <div className="movement-preview-hud">
        <span>{definition.maturity === 'planned' ? 'Blueprint' : 'Motion preview'}</span>
        {definition.maturity === 'planned' ? (
          <Lock size={14} aria-hidden="true" />
        ) : (
          <Play size={13} aria-hidden="true" />
        )}
      </div>
      <i className="preview-scanline" />
    </div>
  );
}

function MovementDefinitionInspector({
  definition,
  exerciseGuideAssetBasePath,
}: {
  readonly definition: MovementDefinition;
  readonly exerciseGuideAssetBasePath: string;
}): ReactElement {
  const guide = exerciseGuideFor(definition.type, exerciseGuideAssetBasePath);
  const maturitySteps = movementMaturitySteps(definition);
  const readinessChecklist = movementReadinessChecklist(definition);
  const validationGapReasons = movementValidationGapReasons(definition, readinessChecklist);
  const planningPriority = movementPlanningPriority(definition);

  return (
    <aside className="movement-inspector" aria-label="Movement definition details">
      <div className="movement-inspector-heading">
        <span>Definition inspector</span>
        <h2>{definition.label}</h2>
        <p>
          {formatMovementCategory(definition.category)} /{' '}
          {formatBodyOrientation(definition.bodyOrientation)} /{' '}
          {formatMaturityLevel(definition.maturity)}
        </p>
      </div>

      <section className="movement-inspector-card">
        <div className="exercise-panel-heading">
          <div>
            <span>Movement preview</span>
            <h3>Diagnostic reference</h3>
          </div>
          <small>{formatCameraAngle(definition.defaultCameraAngle)}</small>
        </div>
        <MovementPreviewFrame definition={definition} guide={guide} />
      </section>

      <section className="movement-inspector-card">
        <div className="exercise-panel-heading">
          <div>
            <span>Recognition maturity</span>
            <h3>Capability stages</h3>
          </div>
          <strong>{movementMaturityScore(definition)}%</strong>
        </div>
        <div className="maturity-rail">
          {maturitySteps.map((step) => (
            <div key={step.label} data-active={step.active}>
              <i />
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="movement-inspector-card">
        <div className="exercise-panel-heading">
          <div>
            <span>Promotion gates</span>
            <h3>Validation readiness</h3>
          </div>
          <strong>
            {readinessChecklist.filter((item) => item.passed).length}/{readinessChecklist.length}
          </strong>
        </div>
        <ul className="readiness-checklist">
          {readinessChecklist.map((item) => (
            <li key={item.stage} data-passed={item.passed}>
              {item.passed ? (
                <CheckCircle2 size={14} aria-hidden="true" />
              ) : (
                <CircleAlert size={14} aria-hidden="true" />
              )}
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {validationGapReasons.length > 0 ? (
        <section className="movement-inspector-card">
          <div className="exercise-panel-heading">
            <div>
              <span>Validation gap</span>
              <h3>Why not fully validated yet</h3>
            </div>
          </div>
          <ul className="validation-gap-list">
            {validationGapReasons.map((reason) => (
              <li key={reason}>
                <CircleAlert size={14} aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="movement-inspector-grid">
        <div>
          <span>Best camera</span>
          <strong>{formatCameraAngle(definition.defaultCameraAngle)}</strong>
        </div>
        <div>
          <span>Alt angles</span>
          <strong>{definition.supportedCameraAngles.map(formatCameraAngle).join(', ')}</strong>
        </div>
        <div>
          <span>Telemetry</span>
          <strong>{movementTelemetryRichness(definition)}%</strong>
        </div>
        <div>
          <span>Complexity</span>
          <strong>{movementComplexityLabel(definition)}</strong>
        </div>
        {definition.maturity === 'planned' ? (
          <div>
            <span>Planned priority</span>
            <strong>
              {planningPriority.label} / {planningPriority.score}
            </strong>
          </div>
        ) : null}
      </section>

      <section className="movement-inspector-card">
        <div className="exercise-panel-heading">
          <div>
            <span>Engine watches</span>
            <h3>Body model and rhythm</h3>
          </div>
        </div>
        <div className="movement-watch-grid">
          <div>
            <span>Orientation</span>
            <strong>{formatBodyOrientation(definition.bodyOrientation)}</strong>
          </div>
          <div>
            <span>Rhythm</span>
            <strong>{formatMovementRhythm(definition.profile.rhythm)}</strong>
          </div>
          <div>
            <span>Primitive</span>
            <strong>{formatMovementFamily(definition.profile.family)}</strong>
          </div>
          <div>
            <span>Camera sensitivity</span>
            <strong>{formatCameraSensitivity(definition.profile.cameraSensitivity)}</strong>
          </div>
        </div>
        <div className="movement-watch-list">
          <div>
            <span>Required regions</span>
            <p>{definition.profile.requiredRegions.map(formatMovementRegion).join(', ')}</p>
          </div>
          <div>
            <span>Primary joints</span>
            <p>{definition.profile.primaryJoints.join(', ')}</p>
          </div>
          <div>
            <span>Phase model</span>
            <p>{definition.profile.phaseModel.join(' -> ')}</p>
          </div>
        </div>
      </section>

      <section className="movement-inspector-card">
        <div className="exercise-panel-heading">
          <div>
            <span>Analysis signals</span>
            <h3>Tracked movement relationships</h3>
          </div>
        </div>
        <ul className="analysis-signal-list">
          {definition.analysisSignals.map((signal) => (
            <li key={signal}>
              <Cpu size={14} aria-hidden="true" />
              {signal}
            </li>
          ))}
        </ul>
      </section>

      <section className="movement-inspector-card">
        <div className="exercise-panel-heading">
          <div>
            <span>Telemetry channels</span>
            <h3>Current output surface</h3>
          </div>
        </div>
        {definition.telemetryMetrics.length === 0 ? (
          <p className="movement-placeholder-note">
            Telemetry channels are not implemented for this dormant movement profile.
          </p>
        ) : (
          <div className="telemetry-channel-grid">
            {definition.telemetryMetrics.map((metric) => (
              <span key={metric.key}>
                <Layers3 size={14} aria-hidden="true" />
                {metric.label}
              </span>
            ))}
          </div>
        )}
      </section>
    </aside>
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

function readSettingsPreferences(): AppSettingsPreferences {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(settingsPreferencesStorageKey) ?? '{}',
    ) as Partial<AppSettingsPreferences>;

    return {
      cameraDeviceId:
        typeof parsed.cameraDeviceId === 'string' && parsed.cameraDeviceId.length > 0
          ? parsed.cameraDeviceId
          : undefined,
      cameraResolution: isSettingsResolution(parsed.cameraResolution)
        ? parsed.cameraResolution
        : defaultSettingsPreferences.cameraResolution,
      cameraFrameRate: isSettingsFrameRate(parsed.cameraFrameRate)
        ? parsed.cameraFrameRate
        : defaultSettingsPreferences.cameraFrameRate,
      cameraMirror:
        typeof parsed.cameraMirror === 'boolean'
          ? parsed.cameraMirror
          : defaultSettingsPreferences.cameraMirror,
      cameraPositionGuide: isSettingsPositionGuide(parsed.cameraPositionGuide)
        ? parsed.cameraPositionGuide
        : defaultSettingsPreferences.cameraPositionGuide,
      skeletonVisible:
        typeof parsed.skeletonVisible === 'boolean'
          ? parsed.skeletonVisible
          : defaultSettingsPreferences.skeletonVisible,
      telemetryOpacity: clampNumber(
        parsed.telemetryOpacity,
        defaultSettingsPreferences.telemetryOpacity,
        55,
        100,
      ),
      telemetryBlur: clampNumber(
        parsed.telemetryBlur,
        defaultSettingsPreferences.telemetryBlur,
        0,
        24,
      ),
      autoSaveSessions:
        typeof parsed.autoSaveSessions === 'boolean'
          ? parsed.autoSaveSessions
          : defaultSettingsPreferences.autoSaveSessions,
    };
  } catch {
    return defaultSettingsPreferences;
  }
}

function isSettingsResolution(value: unknown): value is SettingsResolution {
  return value === 'auto' || value === '720p' || value === '1080p';
}

function isSettingsFrameRate(value: unknown): value is SettingsFrameRate {
  return value === '30' || value === '60';
}

function isSettingsPositionGuide(value: unknown): value is SettingsPositionGuide {
  return value === 'auto' || value === 'side' || value === 'front';
}

function writeSettingsPreferences(preferences: AppSettingsPreferences): void {
  try {
    localStorage.setItem(settingsPreferencesStorageKey, JSON.stringify(preferences));
  } catch {
    // Settings persistence must never block camera startup or local tracking.
  }
}

function readDeveloperTraceEnabled(): boolean {
  try {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get('dev-trace') === '1' || searchParams.get('trace') === 'pose') {
      localStorage.setItem(developerTraceFlagStorageKey, '1');
      return true;
    }

    if (searchParams.get('dev-trace') === '0') {
      localStorage.removeItem(developerTraceFlagStorageKey);
      return false;
    }

    return localStorage.getItem(developerTraceFlagStorageKey) === '1';
  } catch {
    return false;
  }
}

function readDeveloperBenchmarkEnabled(): boolean {
  try {
    const searchParams = new URLSearchParams(window.location.search);

    if (searchParams.get('dev-benchmark') === '1' || searchParams.get('benchmark') === 'runtime') {
      localStorage.setItem(developerBenchmarkFlagStorageKey, '1');
      return true;
    }

    if (searchParams.get('dev-benchmark') === '0') {
      localStorage.removeItem(developerBenchmarkFlagStorageKey);
      return false;
    }

    return localStorage.getItem(developerBenchmarkFlagStorageKey) === '1';
  } catch {
    return false;
  }
}

function downloadPoseTrace(trace: PoseTrace): string {
  const filename = poseTraceFilename(trace.createdAt);
  const blob = new Blob([serializePoseTrace(trace)], { type: 'application/json' });
  downloadBlob(blob, filename);

  return filename;
}

function downloadRuntimeBenchmarkReport(report: RuntimeBenchmarkReport): string {
  const filename = runtimeBenchmarkFilename(report.generatedAt);
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: 'application/json',
  });

  downloadBlob(blob, filename);

  return filename;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function poseTraceFilename(createdAt: string): string {
  return `pose-trace-${createdAt.replaceAll(/[:.]/g, '-')}.json`;
}

function runtimeBenchmarkFilename(generatedAt: string): string {
  return `perception-runtime-benchmark-${generatedAt.replaceAll(/[:.]/g, '-')}.json`;
}

function modelAssetBasePath(modelAssetPath: string): string {
  const lastSlashIndex = modelAssetPath.lastIndexOf('/');

  return lastSlashIndex === -1 ? '.' : modelAssetPath.slice(0, lastSlashIndex);
}

async function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
    };
    const handleLoadedMetadata = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error('Benchmark video metadata failed to load.'));
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

function cameraResolutionConstraints(
  resolution: SettingsResolution,
): Pick<MediaTrackConstraints, 'width' | 'height'> {
  if (resolution === '1080p') {
    return {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };
  }

  if (resolution === '720p') {
    return {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
  }

  return {};
}

function cameraFrameRateConstraints(
  frameRate: SettingsFrameRate,
): MediaTrackConstraints['frameRate'] {
  const target = Number(frameRate);

  return {
    min: target === 60 ? 54 : 27,
    ideal: target,
    max: target + 1,
  };
}

function cameraCaptureConstraints(preferences: AppSettingsPreferences): MediaTrackConstraints {
  return {
    ...cameraLiveCaptureConstraints(preferences),
    ...(preferences.cameraDeviceId
      ? { deviceId: { exact: preferences.cameraDeviceId } }
      : { facingMode: 'user' }),
  };
}

function cameraLiveCaptureConstraints(
  preferences: AppSettingsPreferences,
): Pick<MediaTrackConstraints, 'width' | 'height' | 'frameRate'> {
  return {
    ...cameraResolutionConstraints(preferences.cameraResolution),
    frameRate: cameraFrameRateConstraints(preferences.cameraFrameRate),
  };
}

function cameraStreamInfoFor(
  stream: MediaStream,
  preferences: AppSettingsPreferences,
): CameraStreamInfo {
  const [track] = stream.getVideoTracks();
  const settings = track?.getSettings();
  const requestedResolution = cameraResolutionFor(preferences.cameraResolution);

  return {
    width: settings?.width,
    height: settings?.height,
    frameRate: settings?.frameRate,
    deviceId: settings?.deviceId,
    requestedWidth: requestedResolution?.width,
    requestedHeight: requestedResolution?.height,
    requestedFrameRate: Number(preferences.cameraFrameRate),
  };
}

function formatCameraStreamInfo(info: CameraStreamInfo | undefined): string {
  if (!info?.width || !info.height) {
    return 'Capture pending';
  }

  const requestedResolution =
    info.requestedWidth && info.requestedHeight
      ? `${info.requestedWidth} x ${info.requestedHeight}`
      : undefined;
  const actualResolution = `${info.width} x ${info.height}`;
  const resolution =
    requestedResolution && requestedResolution !== actualResolution
      ? `${actualResolution} (${requestedResolution} requested)`
      : actualResolution;
  const actualFrameRate = info.frameRate ? Math.round(info.frameRate) : undefined;
  const requestedFrameRate = info.requestedFrameRate;
  const frameRate = actualFrameRate
    ? ` / ${actualFrameRate} FPS${requestedFrameRate && actualFrameRate !== requestedFrameRate ? ` (${requestedFrameRate} requested)` : ''}`
    : '';

  return `${resolution}${frameRate}`;
}

function cameraResolutionFor(
  resolution: SettingsResolution,
): { readonly width: number; readonly height: number } | undefined {
  if (resolution === '1080p') {
    return { width: 1920, height: 1080 };
  }

  if (resolution === '720p') {
    return { width: 1280, height: 720 };
  }

  return undefined;
}

function clampNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function describeCameraSettingsError(error: unknown, preferences: AppSettingsPreferences): string {
  const requestedResolution = cameraResolutionFor(preferences.cameraResolution);
  const requestedCapture = [
    requestedResolution ? `${requestedResolution.width} x ${requestedResolution.height}` : 'auto',
    `${preferences.cameraFrameRate} FPS`,
  ].join(' / ');

  if (error instanceof DOMException && error.name === 'OverconstrainedError') {
    return `The active camera does not support the selected capture target (${requestedCapture}). Choose a lower camera setting or select another camera.`;
  }

  return error instanceof Error
    ? `Could not apply camera settings (${requestedCapture}): ${error.message}`
    : `Could not apply camera settings (${requestedCapture}).`;
}

function NavButton({
  icon,
  active,
  href,
  onNavigate,
  children,
}: {
  readonly icon: ReactElement;
  readonly active: boolean;
  readonly href: string;
  readonly onNavigate: () => void;
  readonly children: string;
}): ReactElement {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    onNavigate();
  };

  return (
    <a className={active ? 'active' : undefined} href={href} onClick={handleClick}>
      {icon}
      {children}
    </a>
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

function strongestTelemetrySignal(
  state: MovementInterpreterState,
  telemetry: ActivitySessionTelemetry,
): number | undefined {
  const signals = [
    state.metrics.poseConfidence,
    state.metrics.movementConfidence,
    state.metrics.temporalCandidateConfidence,
    telemetry.activityConfidence,
    telemetry.recognitionConfidence,
  ].filter((value): value is number => value !== undefined && !Number.isNaN(value));

  return signals.length === 0 ? undefined : Math.max(...signals);
}

function cameraAngleForSettingsPreferences(preferences: AppSettingsPreferences): CameraAngle {
  if (preferences.cameraPositionGuide === 'side') {
    return 'side';
  }

  return naturalCameraAngle;
}

function isKeyboardInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    tagName === 'button'
  );
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

function sessionTransitionEvents(
  session: ActivitySession,
): readonly ActivitySession['timeline'][number][] {
  return session.timeline.filter((event) => event.kind === 'transition');
}

function formatMovementDuration(movement: MovementSegment): string {
  if (!movement.endedAt) {
    return 'active';
  }

  const startedAt = new Date(movement.startedAt).getTime();
  const endedAt = new Date(movement.endedAt).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return 'n/a';
  }

  return formatDuration(Math.max(0, Math.round((endedAt - startedAt) / 1000)));
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

function sessionGuidanceCount(session: ActivitySession): number {
  return session.movements.reduce(
    (sum, movement) =>
      sum +
      (movement.guidanceEvents?.filter((event) => event.code !== 'conditions_usable').length ?? 0),
    0,
  );
}

function sessionAverageRecognitionConfidence(session: ActivitySession): number | undefined {
  const confidences = session.movements
    .map((movement) => movement.recognitionConfidence)
    .filter((value): value is number => value !== undefined);

  if (confidences.length === 0) {
    return undefined;
  }

  return confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
}

function formatSessionCameraAngles(session: ActivitySession): string {
  const angles = [
    ...new Set(session.movements.map((movement) => formatCameraAngle(movement.cameraAngle))),
  ];

  return angles.length === 0 ? 'n/a' : angles.join(', ');
}

function sessionTimelineCount(
  session: ActivitySession,
  kind: ActivitySession['timeline'][number]['kind'],
): number {
  return session.timeline.filter((event) => event.kind === kind).length;
}

function sessionCameraGuidanceMessages(session: ActivitySession): readonly string[] {
  return [
    ...new Set(
      session.timeline
        .filter((event) => event.kind === 'camera_guidance' && event.message)
        .map((event) => event.message!),
    ),
  ].slice(0, 4);
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

function movementQualityBreakdown(movement: MovementSegment): {
  readonly rangeScore?: number;
  readonly alignmentScore?: number;
  readonly rhythmScore?: number;
  readonly confidenceScore?: number;
} {
  return {
    rangeScore: averageRepComponent(movement, (event) => event.rangeScore),
    alignmentScore: averageRepComponent(movement, (event) => event.alignmentScore),
    rhythmScore: averageRepComponent(movement, (event) => event.rhythmScore),
    confidenceScore: averageRepComponent(movement, (event) => event.confidenceScore),
  };
}

function averageRepComponent(
  movement: MovementSegment,
  selector: (event: MovementSegment['repEvents'][number]) => number,
): number | undefined {
  if (movement.repEvents.length === 0) {
    return undefined;
  }

  return (
    movement.repEvents.reduce((sum, event) => sum + selector(event), 0) / movement.repEvents.length
  );
}

function formatSecondsValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}s`;
}

function formatRestWindow(movement: MovementSegment): string {
  const before = formatSecondsValue(movement.setSummary?.restBeforeSeconds);
  const after = formatSecondsValue(movement.setSummary?.restAfterSeconds);

  if (before === 'n/a' && after === 'n/a') {
    return 'n/a';
  }

  return `${before} / ${after}`;
}

function formatCodeLabel(code: string): string {
  return code.replaceAll('_', ' ');
}

function formatMovementSegmentState(movement: MovementSegment): string {
  return [
    movement.activityState ? formatActivityState(movement.activityState) : 'state n/a',
    movement.recognitionConfidence !== undefined
      ? `${formatMetric(movement.recognitionConfidence, '%')} signal`
      : 'signal n/a',
  ].join(' / ');
}

function movementTelemetryEntries(
  movement: MovementSegment,
): readonly (readonly [string, string])[] {
  const metrics = movement.telemetryMetrics ?? {};

  return [
    ['activity', movement.activityState ? formatActivityState(movement.activityState) : 'n/a'],
    ['signal', formatMetric(movement.recognitionConfidence, '%')],
    ['range', formatMetric(metrics.rangeOfMotionScore, '%')],
    ['stability', formatMetric(metrics.temporalStabilityScore, '%')],
    ['phase velocity', formatMetric(metrics.phaseVelocity, 'deg')],
  ];
}

function formatQualityScore(score: number | undefined): string {
  return score === undefined || score === 0 ? 'n/a' : `${score}%`;
}

function movementMaturityScore(definition: MovementDefinition): number {
  if (definition.maturity === 'planned') {
    return 18 + definition.analysisSignals.length * 3;
  }

  const supportBaseByMaturity: Record<MovementDefinition['maturity'], number> = {
    planned: 18,
    detected: 30,
    recognized: 44,
    rep_counting: 58,
    rep_validating: 72,
    quality_validating: 86,
  };
  const supportBase = supportBaseByMaturity[definition.maturity];
  const telemetryWeight = Math.min(18, definition.telemetryMetrics.length * 4);
  const phaseWeight = Math.min(8, definition.phaseLabels.length * 2);
  const cameraWeight = Math.min(6, definition.supportedCameraAngles.length * 2);

  return Math.min(96, supportBase + telemetryWeight + phaseWeight + cameraWeight);
}

function movementTelemetryRichness(definition: MovementDefinition): number {
  if (definition.telemetryMetrics.length === 0) {
    return 0;
  }

  return Math.min(100, 24 + definition.telemetryMetrics.length * 18);
}

function movementDefinitionSummary(definition: MovementDefinition): string {
  if (definition.maturity === 'planned') {
    return `${definition.analysisSignals.join(' / ')}. Movement profile not implemented yet.`;
  }

  return `${definition.analysisSignals.join(' / ')}. ${definition.cameraGuidance.usableMessage}`;
}

function movementComplexityLabel(definition: MovementDefinition): string {
  if (definition.bodyOrientation === 'mixed' || definition.category === 'compound') {
    return 'High complexity';
  }

  if (definition.category === 'hold') {
    return 'Stability sensitive';
  }

  if (definition.supportedCameraAngles.length > 2) {
    return 'Calibration flexible';
  }

  return 'Calibration sensitive';
}

function compareMovementDefinitionsForCatalog(
  first: MovementDefinition,
  second: MovementDefinition,
): number {
  if (first.maturity === 'planned' && second.maturity === 'planned') {
    return movementPlanningPriority(second).score - movementPlanningPriority(first).score;
  }

  if (first.maturity === 'planned') {
    return 1;
  }

  if (second.maturity === 'planned') {
    return -1;
  }

  return movementMaturityRank(second.maturity) - movementMaturityRank(first.maturity);
}

function movementPlanningPriority(definition: MovementDefinition): {
  readonly score: number;
  readonly label: 'High' | 'Medium' | 'Low';
} {
  if (definition.maturity !== 'planned') {
    return { score: movementMaturityScore(definition), label: 'High' };
  }

  const cameraScore =
    definition.profile.cameraSensitivity === 'low'
      ? 24
      : definition.profile.cameraSensitivity === 'medium'
        ? 16
        : 8;
  const categoryScore =
    definition.category === 'hold' ? 18 : definition.category === 'repetition' ? 16 : 10;
  const regionScore = Math.max(4, 20 - definition.profile.requiredRegions.length * 2);
  const telemetryScore = Math.min(18, definition.profile.telemetrySignals.length * 3);
  const score = Math.min(100, cameraScore + categoryScore + regionScore + telemetryScore);

  if (score >= 62) {
    return { score, label: 'High' };
  }

  if (score >= 48) {
    return { score, label: 'Medium' };
  }

  return { score, label: 'Low' };
}

function movementMaturitySteps(
  definition: MovementDefinition,
): readonly { readonly label: string; readonly active: boolean }[] {
  return [
    { label: 'Profiled', active: true },
    { label: 'Recognized', active: movementMaturityRank(definition.maturity) >= 2 },
    { label: 'Counted', active: movementMaturityRank(definition.maturity) >= 3 },
    { label: 'Validated', active: movementMaturityRank(definition.maturity) >= 4 },
    { label: 'Quality', active: movementMaturityRank(definition.maturity) >= 5 },
  ];
}

function movementValidationGapReasons(
  definition: MovementDefinition,
  readinessChecklist: ReturnType<typeof movementReadinessChecklist>,
): readonly string[] {
  if (movementMaturityRank(definition.maturity) >= movementMaturityRank('rep_validating')) {
    return [];
  }

  const failedReadiness = readinessChecklist
    .filter((item) => !item.passed)
    .map((item) => `${item.label}: ${item.detail}`);
  const plannedCriteria = [
    ...definition.profile.recognitionCriteria,
    ...definition.profile.validationCriteria,
  ]
    .filter((criterion) => criterion.source === 'planned')
    .map((criterion) => criterion.label);
  const plannedTelemetry = definition.profile.telemetryExtractors
    .filter((extractor) => extractor.source === 'planned')
    .map((extractor) => extractor.label);
  const failureCriteria =
    definition.profile.failureCriteria.length > 0
      ? definition.profile.failureCriteria.map((criterion) => `Failure rule pending: ${criterion}`)
      : ['Failure rules are not defined yet.'];

  return uniqueStrings([
    ...failedReadiness,
    ...plannedCriteria,
    ...plannedTelemetry,
    ...failureCriteria,
  ]);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function movementMaturityRank(level: MovementDefinition['maturity']): number {
  const ranks: Record<MovementDefinition['maturity'], number> = {
    planned: 0,
    detected: 1,
    recognized: 2,
    rep_counting: 3,
    rep_validating: 4,
    quality_validating: 5,
  };

  return ranks[level];
}

function formatCameraAngle(cameraAngle: CameraAngle): string {
  return cameraAngle.replaceAll('_', ' ');
}

function formatMovementCategory(category: MovementDefinition['category']): string {
  if (category === 'hold') {
    return 'Static hold';
  }

  if (category === 'compound') {
    return 'Compound';
  }

  return 'Repetition';
}

function formatBodyOrientation(orientation: MovementDefinition['bodyOrientation']): string {
  if (orientation === 'floor') {
    return 'Floor movement';
  }

  if (orientation === 'mixed') {
    return 'Mixed orientation';
  }

  return `${orientation[0].toUpperCase()}${orientation.slice(1)}`;
}

function formatMovementRegion(
  region: MovementDefinition['profile']['requiredRegions'][number],
): string {
  return `${region[0].toUpperCase()}${region.slice(1)}`;
}

function formatMovementRhythm(rhythm: MovementDefinition['profile']['rhythm']): string {
  if (rhythm === 'unknown') {
    return 'Not modeled';
  }

  return `${rhythm[0].toUpperCase()}${rhythm.slice(1)}`;
}

function formatMovementFamily(family: MovementDefinition['profile']['family']): string {
  return family
    .split('_')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatCameraSensitivity(
  sensitivity: MovementDefinition['profile']['cameraSensitivity'],
): string {
  return `${sensitivity[0].toUpperCase()}${sensitivity.slice(1)}`;
}

function formatMaturityLevel(level: MovementDefinition['maturity']): string {
  if (level === 'detected') {
    return 'Detected';
  }

  if (level === 'recognized') {
    return 'Recognized';
  }

  if (level === 'rep_counting') {
    return 'Count-ready';
  }

  if (level === 'rep_validating') {
    return 'Rep-validating';
  }

  if (level === 'quality_validating') {
    return 'Quality-validating';
  }

  return 'Planned';
}

function repCountTelemetryLabel(definition: MovementDefinition): string {
  if (definition.maturity === 'rep_validating' || definition.maturity === 'quality_validating') {
    return 'Validated reps';
  }

  if (definition.maturity === 'rep_counting') {
    return 'Counted reps';
  }

  return 'Observed reps';
}

interface ExerciseGuide {
  readonly label: string;
  readonly src: string;
}

function exerciseGuideFor(
  movementType: MovementType | undefined,
  assetBasePath: string,
): ExerciseGuide | undefined {
  if (!movementType) {
    return undefined;
  }

  const normalizedBasePath = assetBasePath.endsWith('/')
    ? assetBasePath.slice(0, -1)
    : assetBasePath;
  const definition = movementRegistry.find((movement) => movement.type === movementType);

  if (!definition) {
    return undefined;
  }

  return {
    label: definition.label,
    src: `${normalizedBasePath}/${movementType.replaceAll('_', '-')}-guide.gif`,
  };
}

function defaultCatalogDefinition(): MovementDefinition {
  const definition =
    movementRegistry.find((movement) => movement.maturity === 'rep_validating') ??
    movementRegistry[0];

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

  stopMediaStream(mediaStreamForVideo(video) ?? null);
  video.pause();
  video.removeAttribute('src');
  video.srcObject = null;
  video.load();
}

function mediaStreamForVideo(video: HTMLVideoElement | null): MediaStream | undefined {
  return video?.srcObject instanceof MediaStream ? video.srcObject : undefined;
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

interface SessionTimelineRecordingRefs {
  readonly lastRecordedInferenceStatusRef: { current: ActivitySessionTelemetry['inferenceStatus'] };
  readonly lastRecordedCandidateRef: { current: MovementType | undefined };
  readonly lastRecordedGuidanceCodeRef: { current: string | undefined };
  readonly trackingWasLostRef: { current: boolean };
}

function recordSessionTimelineState(
  service: ActivitySessionService,
  state: MovementInterpreterState,
  telemetry: ActivitySessionTelemetry,
  refs: SessionTimelineRecordingRefs,
): void {
  const inferenceStatus = telemetry.inferenceStatus;
  const trackingLost =
    telemetry.activityState === 'tracking_lost' || inferenceStatus === 'tracking_lost';

  if (trackingLost && !refs.trackingWasLostRef.current) {
    service.recordTrackingLost({
      activityState: telemetry.activityState,
      recognitionConfidence: telemetry.recognitionConfidence,
      message: 'Body tracking was interrupted.',
    });
    refs.trackingWasLostRef.current = true;
  }

  if (!trackingLost && refs.trackingWasLostRef.current) {
    service.recordTrackingRecovered({
      activityState: telemetry.activityState,
      recognitionConfidence: telemetry.recognitionConfidence,
      message: 'Body tracking recovered.',
    });
    refs.trackingWasLostRef.current = false;
  }

  if (
    inferenceStatus === 'ambiguous' &&
    refs.lastRecordedInferenceStatusRef.current !== 'ambiguous'
  ) {
    service.recordMovementAmbiguous({
      activityState: telemetry.activityState,
      recognitionConfidence: telemetry.recognitionConfidence,
      competingMovementTypes: telemetry.competingMovementTypes,
      message: 'Movement candidates are close.',
    });
  }

  if (inferenceStatus === 'unknown' && refs.lastRecordedInferenceStatusRef.current !== 'unknown') {
    service.recordMovementCandidate(state.recognition.movementType, {
      activityState: telemetry.activityState,
      recognitionConfidence: telemetry.recognitionConfidence,
      competingMovementTypes: telemetry.competingMovementTypes,
      message: 'Movement evidence is not stable enough to classify.',
    });
  }

  if (
    inferenceStatus === 'recognized' &&
    telemetry.movementType &&
    refs.lastRecordedCandidateRef.current !== telemetry.movementType
  ) {
    service.recordMovementCandidate(telemetry.movementType, {
      activityState: telemetry.activityState,
      recognitionConfidence: telemetry.recognitionConfidence,
      competingMovementTypes: telemetry.competingMovementTypes,
      message: `${movementDefinitionFor(telemetry.movementType).label} candidate detected.`,
    });
    refs.lastRecordedCandidateRef.current = telemetry.movementType;
  }

  const primaryGuidance = primaryGuidanceFor(telemetry);

  if (primaryGuidance && primaryGuidance.code !== refs.lastRecordedGuidanceCodeRef.current) {
    service.recordCameraGuidance(primaryGuidance);
    refs.lastRecordedGuidanceCodeRef.current = primaryGuidance.code;
  }

  refs.lastRecordedInferenceStatusRef.current = inferenceStatus;
}

function primaryGuidanceFor(
  telemetry: ActivitySessionTelemetry,
): NonNullable<ActivitySessionTelemetry['guidanceEvents']>[number] | undefined {
  return telemetry.guidanceEvents?.find((event) => event.code !== 'conditions_usable');
}

function guidanceSeverity(
  guidance:
    | NonNullable<ActivitySessionTelemetry['guidanceEvents']>[number]
    | NonNullable<ActivitySessionTelemetry['cameraAdvice']>
    | CalibrationPreflightSnapshot
    | undefined,
): 'info' | 'warning' {
  if (!guidance || !('severity' in guidance)) {
    return 'info';
  }

  return guidance.severity;
}

function formatSessionMode(mode: ActivitySessionTelemetry['mode']): string {
  return mode.replaceAll('_', ' ');
}

function formatActivityState(
  state: NonNullable<ActivitySessionTelemetry['activityState']>,
): string {
  return state.replaceAll('_', ' ');
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

function formatMetric(value: number | undefined, unit: 'deg' | '%' | 's'): string {
  if (value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  if (unit === '%') {
    return `${Math.round(value * 100)}%`;
  }

  if (unit === 's') {
    return `${Math.round(value)}s`;
  }

  return `${Math.round(value)}deg`;
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
