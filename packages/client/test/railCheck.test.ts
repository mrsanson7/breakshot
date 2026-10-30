import { describe, expect, it } from 'vitest';
import { railWallDeviation, type Point2 } from '../src/render3d/railCheck';

const square: Point2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const edgesOf = (pts: Point2[]): [Point2, Point2][] => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
const shifted = (d: number) => square.map((p) => ({ x: p.x + d, y: p.y }));

describe('railWallDeviation', () => {
  it('is zero for a wall on the outline', () => {
    expect(railWallDeviation(edgesOf(square), square)).toBeCloseTo(0, 9);
  });

  it('measures a shifted wall', () => {
    expect(railWallDeviation(edgesOf(shifted(0.003)), square)).toBeCloseTo(0.003, 6);
    expect(railWallDeviation(edgesOf(shifted(0.001)), square)).toBeCloseTo(0.001, 6);
  });

  it('catches a wall that leaves part of the outline uncovered', () => {
    const partial = edgesOf(square).slice(0, 2);
    expect(railWallDeviation(partial, square)).toBeCloseTo(1, 6);
  });

  it('treats a missing wall as failing', () => {
    expect(railWallDeviation([], square)).toBe(Infinity);
  });
});
