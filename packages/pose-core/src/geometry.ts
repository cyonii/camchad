export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleDegrees(a: Point2D, vertex: Point2D, c: Point2D): number {
  const ab = { x: a.x - vertex.x, y: a.y - vertex.y };
  const cb = { x: c.x - vertex.x, y: c.y - vertex.y };
  const magnitude = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);

  if (magnitude === 0) {
    return 0;
  }

  const dot = ab.x * cb.x + ab.y * cb.y;
  const cosine = Math.max(-1, Math.min(1, dot / magnitude));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function lineDeviationRatio(start: Point2D, middle: Point2D, end: Point2D): number {
  const baseline = distance(start, end);

  if (baseline === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const numerator = Math.abs(
    (end.y - start.y) * middle.x - (end.x - start.x) * middle.y + end.x * start.y - end.y * start.x,
  );

  return numerator / baseline;
}
