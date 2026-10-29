import { LAYOUT } from '../config/layouts';
import type { TableSpec } from '../config/tables';
import { shuffle } from '../math/rng';
import type { BallPosition } from '../physics/types';

const at = (id: string, x: number, y: number): BallPosition => ({ id, x, y, pocketed: false });

/**
 * 8-ball rack: apex on the foot spot pointing at the head, 8 in the centre of the third row,
 * one solid and one stripe in the back corners, the rest shuffled.
 * The cue ball starts on the head spot; the breaker may move it anywhere behind the head string.
 */
export function eightBallRack(table: TableSpec, rng: () => number, gap: number): BallPosition[] {
  const L = table.length;
  const W = table.width;
  const R = table.ball.diameter / 2;
  const d = 2 * R + gap;
  const rowDx = (d * Math.sqrt(3)) / 2;

  const solids = ['1', '2', '3', '4', '5', '6', '7'];
  const stripes = ['9', '10', '11', '12', '13', '14', '15'];
  const sCorner = solids[Math.floor(rng() * solids.length)];
  const tCorner = stripes[Math.floor(rng() * stripes.length)];
  const rest = shuffle(
    [...solids, ...stripes].filter((b) => b !== sCorner && b !== tCorner),
    rng,
  );
  const leftCornerSolid = rng() < 0.5;

  // Slots row by row (row r has r+1 balls). Row 2 index 1 is the 8; row 4 ends are the corners.
  const out: BallPosition[] = [at('cue', L * LAYOUT.headStringX, W * LAYOUT.centreY)];
  let k = 0;
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i <= r; i++) {
      const x = L * LAYOUT.footSpotX + r * rowDx;
      const y = W * LAYOUT.centreY + (i - r / 2) * d;
      let id: string;
      if (r === 2 && i === 1) id = '8';
      else if (r === 4 && i === 0) id = leftCornerSolid ? sCorner : tCorner;
      else if (r === 4 && i === 4) id = leftCornerSolid ? tCorner : sCorner;
      else id = rest[k++];
      out.push(at(id, x, y));
    }
  }
  return out;
}

/**
 * UMB carom opening: red on the foot spot, the opponent's ball on the head spot, the breaker's
 * ball on the head string offset to one side.
 */
export function threeCushionBreak(table: TableSpec, breakerBall: string, otherBall: string, side: 1 | -1): BallPosition[] {
  const L = table.length;
  const W = table.width;
  return [
    at(breakerBall, L * LAYOUT.headStringX, W * LAYOUT.centreY + side * LAYOUT.caromBreakOffset),
    at(otherBall, L * LAYOUT.headStringX, W * LAYOUT.centreY),
    at('red', L * LAYOUT.footSpotX, W * LAYOUT.centreY),
  ];
}

/**
 * 4-ball opening (Korean hall practice, assumption): reds on the foot spot and centre spot,
 * opponent's ball on the head spot, breaker's ball on the head string offset like UMB.
 * TODO(확인 필요): opening positions vary by hall.
 */
export function fourBallBreak(table: TableSpec, breakerBall: string, otherBall: string, side: 1 | -1): BallPosition[] {
  const L = table.length;
  const W = table.width;
  return [
    at(breakerBall, L * LAYOUT.headStringX, W * LAYOUT.centreY + side * LAYOUT.caromBreakOffset),
    at(otherBall, L * LAYOUT.headStringX, W * LAYOUT.centreY),
    at('red', L * LAYOUT.footSpotX, W * LAYOUT.centreY),
    at('red2', L * LAYOUT.centreX, W * LAYOUT.centreY),
  ];
}

/** PBA opening: breaker's ball, opponent's ball and red on the given spots (see LAYOUT.pbaSpots). */
export function pbaOpening(table: TableSpec, breakerBall: string, otherBall: string, spots: readonly [number, number, number]): BallPosition[] {
  const L = table.length;
  const W = table.width;
  const ids = [breakerBall, otherBall, 'red'];
  return spots.map((n, i) => {
    const p = LAYOUT.pbaSpots[n];
    return at(ids[i], L * p.x, W * p.y);
  });
}
