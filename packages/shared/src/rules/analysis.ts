import type { ShotLog } from '../physics/types';

/** What the cue ball did, in event order. Shared by every carom rule set. */
export interface CaromAnalysis {
  /** Distinct balls the cue ball touched, in order of first contact. */
  hits: string[];
  /** Cue-ball cushion contacts before the first object ball (all of them if it hit nothing). */
  cushionsBeforeFirst: number;
  /** Cue-ball cushion contacts before touching the second object ball; null if it never did. */
  cushionsBeforeSecond: number | null;
  /** Cue-ball cushion contacts during the whole shot. */
  totalCushions: number;
}

export function analyzeCarom(log: ShotLog): CaromAnalysis {
  const cue = log.cueBall;
  const hits: string[] = [];
  let cushions = 0;
  let beforeFirst: number | null = null;
  let beforeSecond: number | null = null;
  for (const e of log.events) {
    if (e.type === 'cushion' && e.ball === cue) {
      cushions++;
    } else if (e.type === 'ballBall' && (e.a === cue || e.b === cue)) {
      const other = e.a === cue ? e.b : e.a;
      if (!hits.includes(other)) {
        hits.push(other);
        if (hits.length === 1) beforeFirst = cushions;
        if (hits.length === 2) beforeSecond = cushions;
      }
    }
  }
  return {
    hits,
    cushionsBeforeFirst: beforeFirst ?? cushions,
    cushionsBeforeSecond: beforeSecond,
    totalCushions: cushions,
  };
}

/** Pool: first ball the cue ball touched, and whether any ball reached a cushion afterwards. */
export interface PoolAnalysis {
  firstHit: string | null;
  /** A cushion contact (any ball) after the first cue-ball contact. */
  railAfterContact: boolean;
  /** Distinct object balls that touched a cushion at any time. */
  objectBallsToRail: number;
}

export function analyzePool(log: ShotLog): PoolAnalysis {
  const cue = log.cueBall;
  let firstHit: string | null = null;
  let railAfterContact = false;
  const railed = new Set<string>();
  for (const e of log.events) {
    if (e.type === 'ballBall' && firstHit === null && (e.a === cue || e.b === cue)) {
      firstHit = e.a === cue ? e.b : e.a;
    } else if (e.type === 'cushion') {
      if (firstHit !== null) railAfterContact = true;
      if (e.ball !== cue) railed.add(e.ball);
    }
  }
  return { firstHit, railAfterContact, objectBallsToRail: railed.size };
}
