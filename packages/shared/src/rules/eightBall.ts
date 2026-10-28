import type { EightBallConfig } from '../config/rules';
import { TABLES, type TableSpec } from '../config/tables';
import { LAYOUT } from '../config/layouts';
import { eightBallRack } from '../game/layouts';
import { other, type BallGroup, type MatchState, type Seat, type Verdict } from '../game/state';
import type { BallPosition, ShotLog } from '../physics/types';
import { analyzePool } from './analysis';
import type { RuleSet } from './types';

/**
 * WPA 8-ball (World Standardized Rules), simplified for an online game:
 *  - no called shots / called pockets (assumption, see README)
 *  - illegal break → foul, incoming player gets ball in hand (WPA lets them choose a re-rack)
 *  - 8 pocketed on the break → re-spotted, play continues
 *  - after any foul the incoming player has ball in hand anywhere
 */
export const groupOf = (id: string): BallGroup | 'eight' | 'cue' => {
  if (id === 'cue') return 'cue';
  const n = Number(id);
  if (n === 8) return 'eight';
  return n < 8 ? 'solids' : 'stripes';
};

const opposite = (g: BallGroup): BallGroup => (g === 'solids' ? 'stripes' : 'solids');

/** Put a ball on the foot spot, or the nearest free point behind it on the long string. */
export function respotOnFootString(table: TableSpec, balls: readonly BallPosition[], id: string): BallPosition {
  const R = table.ball.diameter / 2;
  const y = table.width * LAYOUT.centreY;
  const free = (x: number) => balls.every((b) => b.pocketed || b.id === id || Math.hypot(b.x - x, b.y - y) >= 2 * R);
  const spot = table.length * LAYOUT.footSpotX;
  const step = R / 4;
  for (let x = spot; x <= table.length - R; x += step) if (free(x)) return { id, x, y, pocketed: false };
  for (let x = spot; x >= R; x -= step) if (free(x)) return { id, x, y, pocketed: false };
  return { id, x: spot, y, pocketed: false };
}

export const eightBallRules: RuleSet<EightBallConfig> = {
  id: 'wpa8',
  discipline: 'eightBall',
  resetScoreEachSet: true,
  timeoutScope: 'set',

  cueBallOf: () => 'cue',
  initialRuleState: () => ({ kind: 'eightBall', groups: [null, null] }),

  setupRack(_state, table, rng, gap) {
    return { balls: eightBallRack(table, rng, gap), ballInHand: 'kitchen' };
  },

  setsToWin: (c) => c.raceTo,
  target: () => null,

  nextBreaker(state, winner) {
    const c = state.config as EightBallConfig;
    return c.breakRotation === 'winner' ? winner : other(state.breaker);
  },

  onTimeViolation(state): Verdict {
    return {
      shooter: state.current,
      points: 0,
      penalty: 0,
      foul: 'timeViolation',
      keepTurn: false,
      ballInHand: 'anywhere',
      tags: ['foul'],
    };
  },

  evaluate(state: MatchState, log: ShotLog): Verdict {
    const cfg = state.config as EightBallConfig;
    const shooter = state.current;
    const opp = other(shooter);
    if (state.rule.kind !== 'eightBall') throw new Error('rule state mismatch');
    const groups: [BallGroup | null, BallGroup | null] = [...state.rule.groups];
    const mine = groups[shooter];
    const a = analyzePool(log);

    const pocketed = log.pocketed;
    const scratch = pocketed.includes('cue');
    const eightIn = pocketed.includes('8');
    const objects = pocketed.filter((id) => id !== 'cue' && id !== '8');
    const remainingMine = mine ? state.balls.filter((b) => !b.pocketed && groupOf(b.id) === mine).length : -1;
    const onTheEight = mine !== null && remainingMine === 0;

    // --- Fouls -------------------------------------------------------------------------------
    let foul: Verdict['foul'] = null;
    if (scratch) foul = 'scratch';
    else if (a.firstHit === null) foul = 'noContact';
    else if (state.breakShot) {
      if (objects.length === 0 && !eightIn && a.objectBallsToRail < cfg.legalBreakMinRailBalls) foul = 'illegalBreak';
    } else {
      const first = groupOf(a.firstHit);
      if (mine === null && first === 'eight') foul = 'wrongBallFirst';
      else if (mine !== null && !onTheEight && first !== mine) foul = 'wrongBallFirst';
      else if (onTheEight && first !== 'eight') foul = 'wrongBallFirst';
      else if (pocketed.length === 0 && !a.railAfterContact) foul = 'noRail';
    }

    const base: Verdict = {
      shooter,
      points: 0,
      penalty: 0,
      foul,
      keepTurn: false,
      ballInHand: foul ? 'anywhere' : null,
      tags: foul ? ['foul'] : [],
    };

    // --- The 8 -------------------------------------------------------------------------------
    if (eightIn) {
      if (state.breakShot) {
        const balls = log.final.map((b) => (b.id === '8' ? { ...b, pocketed: true } : b));
        const respot = respotOnFootString(tableOf(state), balls, '8');
        base.respot = [respot];
        base.tags.push('eightRespotted');
      } else {
        // Legal only when the group was already cleared and the shot is otherwise clean.
        const win = onTheEight && !foul;
        if (!win) base.tags.push('eightEarly');
        base.setWinner = win ? shooter : opp;
        base.tags.push('rackWon');
        return base;
      }
    }

    if (foul) return base;

    // --- Groups and continuing ---------------------------------------------------------------
    if (state.breakShot) {
      base.keepTurn = objects.length > 0; // table stays open after the break
    } else if (mine === null) {
      if (objects.length > 0) {
        const g = groupOf(objects[0]) as BallGroup;
        groups[shooter] = g;
        groups[opp] = opposite(g);
        base.rule = { kind: 'eightBall', groups };
        base.tags.push('groupAssigned');
        base.keepTurn = true;
      }
    } else {
      base.keepTurn = objects.some((id) => groupOf(id) === mine);
    }
    if (base.keepTurn) base.tags.push('score');
    else base.tags.push('miss');
    return base;
  },
};

const tableOf = (state: MatchState): TableSpec => TABLES[state.table];
