import type { ReactElement } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { HistoryChartModel } from './history-chart.js';

export function ActivityLogChart({ model }: { readonly model: HistoryChartModel }): ReactElement {
  const data = model.points.map((point) => ({
    ...point,
    durationMinutes: Math.round((point.durationSeconds / 60) * 10) / 10,
  }));

  return (
    <section className="chart-panel" aria-labelledby="activity-chart-title">
      <div className="chart-heading">
        <div>
          <span>Progress</span>
          <h2 id="activity-chart-title">Movement load by day</h2>
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
          <span>
            <i className="legend-quality" />
            Quality
          </span>
        </div>
      </div>

      {!model.hasActivities ? (
        <div className="chart-empty">Complete an activity to see movement trends.</div>
      ) : (
        <div className="activity-chart-stack">
          <div className="activity-chart-frame">
            <ResponsiveContainer width="100%" height={292}>
              <ComposedChart data={data} margin={{ top: 18, right: 12, bottom: 12, left: -18 }}>
                <CartesianGrid stroke="rgb(var(--primary-rgb) / 10%)" vertical={false} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--text-subtle)', fontSize: 12 }}
                />
                <YAxis
                  yAxisId="reps"
                  axisLine={false}
                  tickLine={false}
                  domain={[0, model.maxReps]}
                  tick={{ fill: 'var(--text-subtle)', fontSize: 12 }}
                />
                <YAxis
                  yAxisId="quality"
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 100]}
                  tick={{ fill: 'var(--text-subtle)', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'rgb(var(--primary-rgb) / 6%)' }}
                  contentStyle={{
                    border: '1px solid rgb(var(--primary-rgb) / 22%)',
                    borderRadius: 8,
                    background: 'var(--surface-glass-strong)',
                    color: 'var(--text)',
                  }}
                  labelStyle={{ color: 'var(--text)' }}
                />
                <Area
                  yAxisId="reps"
                  type="monotone"
                  dataKey="durationMinutes"
                  name="Duration (min)"
                  fill="rgb(var(--primary-rgb) / 10%)"
                  stroke="rgb(var(--primary-rgb) / 24%)"
                />
                <Bar
                  yAxisId="reps"
                  dataKey="validReps"
                  name="Valid reps"
                  stackId="reps"
                  fill="var(--primary)"
                  shape={(props: unknown) => (
                    <StackedRepBarSegment
                      {...barShapeProps(props)}
                      roundedTopWhen={(payload) => payload.partialReps === 0}
                    />
                  )}
                />
                <Bar
                  yAxisId="reps"
                  dataKey="partialReps"
                  name="Partial reps"
                  stackId="reps"
                  fill="var(--chart-partial)"
                  shape={(props: unknown) => (
                    <StackedRepBarSegment {...barShapeProps(props)} roundedTopWhen={() => true} />
                  )}
                />
                <Line
                  yAxisId="quality"
                  type="monotone"
                  dataKey="averageQuality"
                  name="Avg quality"
                  stroke="var(--warning)"
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 0, fill: 'var(--warning)' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-breakdown-grid" aria-label="Movement breakdown">
            {model.movementBreakdown.map((movement) => (
              <div key={movement.movementType}>
                <span>{movement.label}</span>
                <strong>{movement.validReps}</strong>
                <small>
                  {movement.sets} sets / {movement.partialReps} partial /{' '}
                  {formatQualityScore(movement.averageQuality)} avg
                </small>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function formatQualityScore(score: number | undefined): string {
  return score === undefined || score === 0 ? 'n/a' : `${score}%`;
}

interface ChartBarPayload {
  readonly partialReps?: number;
}

interface ChartBarShapeProps {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly payload: ChartBarPayload;
}

function StackedRepBarSegment({
  x,
  y,
  width,
  height,
  fill,
  payload,
  roundedTopWhen,
}: ChartBarShapeProps & {
  readonly roundedTopWhen: (payload: ChartBarPayload) => boolean;
}): ReactElement {
  if (height <= 0 || width <= 0) {
    return <g />;
  }

  const radius = roundedTopWhen(payload) ? Math.min(6, width / 2, height / 2) : 0;

  return <path d={roundedTopRectPath(x, y, width, height, radius)} fill={fill} />;
}

function barShapeProps(props: unknown): ChartBarShapeProps {
  const shapeProps = props as Partial<ChartBarShapeProps>;

  return {
    x: Number(shapeProps.x ?? 0),
    y: Number(shapeProps.y ?? 0),
    width: Number(shapeProps.width ?? 0),
    height: Number(shapeProps.height ?? 0),
    fill: shapeProps.fill ?? 'currentColor',
    payload: shapeProps.payload ?? {},
  };
}

function roundedTopRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  if (radius <= 0) {
    return `M${x},${y}h${width}v${height}h-${width}z`;
  }

  const right = x + width;
  const bottom = y + height;

  return [
    `M${x},${bottom}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${right - radius}`,
    `Q${right},${y} ${right},${y + radius}`,
    `V${bottom}`,
    'Z',
  ].join(' ');
}
