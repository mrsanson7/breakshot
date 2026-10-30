export interface Point2 {
  x: number;
  y: number;
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * Largest plan-view gap between a rail model's inner wall and the expected opening, measured both
 * ways so a wall that strays and a wall that leaves part of the outline uncovered both count.
 * `wallEdges` are the wall's edges in world x, y; `outline` is the closed opening polygon.
 */
export function railWallDeviation(wallEdges: readonly [Point2, Point2][], outline: readonly Point2[]): number {
  if (wallEdges.length === 0 || outline.length === 0) return Infinity;
  let worst = 0;
  for (const edge of wallEdges) {
    for (const p of edge) {
      let best = Infinity;
      outline.forEach((a, i) => {
        best = Math.min(best, distanceToSegment(p, a, outline[(i + 1) % outline.length]));
      });
      worst = Math.max(worst, best);
    }
  }
  for (const p of outline) {
    let best = Infinity;
    for (const [a, b] of wallEdges) best = Math.min(best, distanceToSegment(p, a, b));
    worst = Math.max(worst, best);
  }
  return worst;
}
