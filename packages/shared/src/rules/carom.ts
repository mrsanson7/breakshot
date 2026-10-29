import type { FourBallConfig, ThreeCushionPbaConfig, ThreeCushionUmbConfig } from '../config/rules';
import { fourBallBreak, pbaOpening, threeCushionBreak } from '../game/layouts';
import { createRng } from '../math/rng';
import { other, type MatchState, type Seat, type Verdict } from '../game/state';
import type { ShotLog } from '../physics/types';
import { analyzeCarom } from './analysis';
import type { RuleSet } from './types';

/** Carom seats: seat 0 plays the white ball, seat 1 the yellow ball. */
const CUE_BALLS = ['white', 'yellow'] as const;
const caromCue = (seat: Seat): string => CUE_BALLS[seat];

/** Turn passes, nothing scored (time violation in carom games). */
const passTurn = (state: MatchState): Verdict => ({
  shooter: state.current,
  points: 0,
  penalty: 0,
  foul: 'timeViolation',
  keepTurn: false,
  ballInHand: null,
  tags: ['foul'],
});

/** Core 3-cushion judgement shared by UMB and PBA. */
function judgeThreeCushion(state: MatchState, log: ShotLog, breakMustHitRedFirst: boolean) {
  const a = analyzeCarom(log);
  const breakFoul = state.breakShot && breakMustHitRedFirst && a.hits.length > 0 && a.hits[0] !== 'red';
  const scored = !breakFoul && a.hits.length >= 2 && (a.cushionsBeforeSecond ?? 0) >= 3;
  return { a, breakFoul, scored };
}

// --------------------------------------------------------------------------------------------
// 3-cushion, UMB

export const threeCushionUmbRules: RuleSet<ThreeCushionUmbConfig> = {
  id: 'umb3c',
  discipline: 'threeCushion',
  resetScoreEachSet: false,
  timeoutScope: 'game',
  cueBallOf: (_s, seat) => caromCue(seat),
  initialRuleState: () => ({ kind: 'carom', lastInning: false }),
  setupRack(state, table, rng) {
    return { balls: threeCushionBreak(table, caromCue(state.breaker), caromCue(other(state.breaker)), rng() < 0.5 ? 1 : -1), ballInHand: null };
  },
  setsToWin: () => 1,
  target: (state) => (state.config as ThreeCushionUmbConfig).targetPoints,
  nextBreaker: (state) => other(state.breaker),
  onTimeViolation(state) {
    const v = passTurn(state);
    // A time violation ends the equalizing inning too.
    if (state.rule.kind === 'carom' && state.rule.lastInning) v.gameWinner = other(state.current);
    return v;
  },

  evaluate(state, log) {
    const cfg = state.config as ThreeCushionUmbConfig;
    const shooter = state.current;
    const { a, breakFoul, scored } = judgeThreeCushion(state, log, cfg.breakMustHitRedFirst);
    const v: Verdict = {
      shooter,
      points: scored ? 1 : 0,
      penalty: 0,
      foul: breakFoul ? 'breakNotRed' : null,
      keepTurn: scored,
      ballInHand: null,
      tags: [breakFoul ? 'foul' : scored ? 'score' : 'miss'],
      cushions: a.cushionsBeforeSecond ?? a.totalCushions,
    };
    const lastInning = state.rule.kind === 'carom' && state.rule.lastInning;
    const total = state.players[shooter].score + v.points;
    if (lastInning) {
      // The opponent's equalizing inning: reaching the target ties the game, a miss ends it.
      if (total >= cfg.targetPoints) {
        v.gameWinner = 'draw';
        v.tags.push('draw');
      } else if (!scored) {
        v.gameWinner = other(shooter);
        v.tags.push('gameWon');
      }
    } else if (total >= cfg.targetPoints) {
      if (cfg.equalizingInning && shooter === state.breaker) {
        v.keepTurn = false;
        v.rule = { kind: 'carom', lastInning: true };
        v.tags.push('equalizingInning');
      } else {
        v.gameWinner = shooter;
        v.tags.push('gameWon');
      }
    }
    return v;
  },
};

// --------------------------------------------------------------------------------------------
// 3-cushion, PBA

export const pbaSetTarget = (cfg: ThreeCushionPbaConfig, set: number): number =>
  set >= 2 * cfg.setsToWin - 1 ? cfg.finalSetPoints : cfg.setPoints;

/**
 * The PBA formation for this match: the configured spots, or one card draw per match (seeded by
 * the match seed only, so every set uses the same formation).
 */
export function pbaFormation(state: Pick<MatchState, 'config' | 'seed'>): [number, number, number] {
  const o = (state.config as ThreeCushionPbaConfig).opening;
  if (o.mode === 'fixed') return [...o.spots];
  const rng = createRng((state.seed ^ 0x5bd1e995) >>> 0);
  return [1 + Math.floor(rng() * 3), 4 + Math.floor(rng() * 3), 7 + Math.floor(rng() * 3)];
}

export const threeCushionPbaRules: RuleSet<ThreeCushionPbaConfig> = {
  id: 'pba3c',
  discipline: 'threeCushion',
  resetScoreEachSet: true,
  timeoutScope: 'set',
  cueBallOf: (_s, seat) => caromCue(seat),
  initialRuleState: () => ({ kind: 'carom', lastInning: false }),
  setupRack(state, table) {
    return { balls: pbaOpening(table, caromCue(state.breaker), caromCue(other(state.breaker)), pbaFormation(state)), ballInHand: null };
  },
  setsToWin: (c) => c.setsToWin,
  target: (state) => pbaSetTarget(state.config as ThreeCushionPbaConfig, state.set),
  nextBreaker(state, winner) {
    const c = state.config as ThreeCushionPbaConfig;
    return c.setBreak === 'loser' ? other(winner) : other(state.breaker);
  },
  onTimeViolation: passTurn,

  evaluate(state, log) {
    const cfg = state.config as ThreeCushionPbaConfig;
    const shooter = state.current;
    const { a, breakFoul, scored } = judgeThreeCushion(state, log, cfg.breakMustHitRedFirst);
    // Bank shot: cushions first, then a valid point (criterion documented in config/rules.ts).
    const bank = scored && cfg.bankShot.enabled && a.cushionsBeforeFirst >= cfg.bankShot.minCushionsBeforeFirstBall;
    const v: Verdict = {
      shooter,
      points: scored ? (bank ? cfg.bankShot.points : 1) : 0,
      penalty: 0,
      foul: breakFoul ? 'breakNotRed' : null,
      keepTurn: scored,
      ballInHand: null,
      tags: [breakFoul ? 'foul' : scored ? 'score' : 'miss'],
      cushions: a.cushionsBeforeSecond ?? a.totalCushions,
    };
    if (bank) v.tags.push('bankShot');
    if (state.players[shooter].score + v.points >= pbaSetTarget(cfg, state.set)) {
      v.setWinner = shooter;
      v.tags.push('setWon');
    }
    return v;
  },
};

// --------------------------------------------------------------------------------------------
// 4-ball (Korean hall standard)

export const fourBallRules: RuleSet<FourBallConfig> = {
  id: 'korean4',
  discipline: 'fourBall',
  resetScoreEachSet: false,
  timeoutScope: 'game',
  cueBallOf: (_s, seat) => caromCue(seat),
  initialRuleState: () => ({ kind: 'carom', lastInning: false }),
  setupRack(state, table, rng) {
    return { balls: fourBallBreak(table, caromCue(state.breaker), caromCue(other(state.breaker)), rng() < 0.5 ? 1 : -1), ballInHand: null };
  },
  setsToWin: () => 1,
  target: (state, seat) => (state.config as FourBallConfig).targets[seat],
  nextBreaker: (state) => other(state.breaker),
  onTimeViolation: passTurn,

  evaluate(state, log) {
    const cfg = state.config as FourBallConfig;
    const shooter = state.current;
    const opponentBall = caromCue(other(shooter));
    const a = analyzeCarom(log);
    let foul: Verdict['foul'] = null;
    if (a.hits.includes(opponentBall)) foul = 'hitOpponentBall';
    else if (a.hits.length === 0) foul = 'noContact';
    const scored = !foul && a.hits.includes('red') && a.hits.includes('red2');
    const v: Verdict = {
      shooter,
      points: scored ? 1 : 0,
      penalty: foul ? cfg.foulPenalty : 0,
      foul,
      keepTurn: scored,
      ballInHand: null,
      tags: [foul ? 'foul' : scored ? 'score' : 'miss'],
    };
    if (state.players[shooter].score + v.points >= cfg.targets[shooter]) {
      v.gameWinner = shooter;
      v.tags.push('gameWon');
    }
    return v;
  },
};
