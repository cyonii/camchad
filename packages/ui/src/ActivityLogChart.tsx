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
                    boxShadow: '0 18px 44px var(--shadow)',
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
                  radius={[5, 5, 0, 0]}
                  fill="var(--primary)"
                />
                <Bar
                  yAxisId="reps"
                  dataKey="partialReps"
                  name="Partial reps"
                  stackId="reps"
                  radius={[5, 5, 0, 0]}
                  fill="var(--chart-partial)"
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
