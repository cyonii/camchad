import { movementDefinitionFor } from '@camchad/movement-core';

import type {
  ActivitySession,
  ActivitySessionAnalysisSummary,
  MovementSegment,
} from '@camchad/activity-history';

export interface SessionFatiguePoint {
  readonly id: string;
  readonly label: string;
  readonly movementLabel: string;
  readonly fatigueScore: number;
  readonly confidenceScore?: number;
  readonly warningCount: number;
  readonly guidanceCount: number;
}

export interface SessionFatigueModel {
  readonly sessionFatigueScore: number;
  readonly confidenceTrend: ActivitySessionAnalysisSummary['confidenceTrend'];
  readonly points: readonly SessionFatiguePoint[];
}

export function buildSessionFatigueModel(session: ActivitySession): SessionFatigueModel {
  const confidenceBaseline = firstFinite(
    session.movements.map((movement) => movement.recognitionConfidence),
  );
  const points = session.movements.map((movement, index) =>
    fatiguePointFor(movement, index, confidenceBaseline),
  );

  return {
    sessionFatigueScore:
      session.summary?.fatigueScore ??
      average(points.map((point) => point.fatigueScore).filter((score) => score > 0)),
    confidenceTrend: session.summary?.confidenceTrend ?? 'unknown',
    points,
  };
}

function fatiguePointFor(
  movement: MovementSegment,
  index: number,
  confidenceBaseline: number | undefined,
): SessionFatiguePoint {
  const telemetryFatigue = finiteMetric(movement.telemetryMetrics?.fatigueScore);
  const confidenceDrop =
    confidenceBaseline === undefined || movement.recognitionConfidence === undefined
      ? 0
      : Math.max(0, confidenceBaseline - movement.recognitionConfidence);
  const warningCount = movement.formWarnings.length;
  const guidanceCount =
    movement.guidanceEvents?.filter((event) => event.code !== 'conditions_usable').length ?? 0;
  const derivedFatigue = clamp01(confidenceDrop * 0.8 + (warningCount + guidanceCount) * 0.12);
  const definition = movementDefinitionFor(movement.movementType);

  return {
    id: movement.id,
    label: `S${index + 1}`,
    movementLabel: definition.label,
    fatigueScore: telemetryFatigue ?? derivedFatigue,
    confidenceScore: movement.recognitionConfidence,
    warningCount,
    guidanceCount,
  };
}

function finiteMetric(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : clamp01(value);
}

function firstFinite(values: readonly (number | undefined)[]): number | undefined {
  return values.find((value): value is number => value !== undefined && Number.isFinite(value));
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
