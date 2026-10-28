import { DISCIPLINES } from '../config/disciplines';
import { PHYSICS } from '../config/physics';
import { RULE_DEFAULTS, type RuleConfigs, type RuleSetId } from '../config/rules';
import { TABLES, type TableId } from '../config/tables';
import { createRng } from '../math/rng';
import type { Vec2 } from '../math/vec';
import { buildTableGeometry, type TableGeometry } from '../physics/geometry';
import { simulateShot } from '../physics/simulation';
import type { ShotInput, ShotLog } from '../physics/types';
import { RULESETS } from '../rules/registry';
import type { RuleSet } from '../rules/types';
import { isValidPlacement } from './placement';
import { assertTransition, other, type AnyRuleConfig, type GamePhase, type MatchState, type PlayerState, type Seat, type Verdict } from './state';

/**
 * Match engine: owns the state machine and applies Verdicts. Pure functions on immutable
 * MatchState values, used identically by the server (authoritative) and practice mode.
 */

export interface MatchSetup<R extends RuleSetId = RuleSetId> {
  ruleSet: R;
  table: TableId;
  /** Overrides on top of RULE_DEFAULTS[ruleSet]. */
  config?: Partial<RuleConfigs[R]>;
  names: [string, string];
  seed: number;
  /** Who breaks first (decided by lag or at random). */
  firstBreaker: Seat;
}

export interface ShotRequest {
  input: ShotInput;
  /** Required when the shooter has ball in hand. */
  cueBallPos?: Vec2;
}

export type ShotError =
  | 'notYourTurn'
  | 'wrongPhase'
  | 'badInput'
  | 'placementRequired'
  | 'badPlacement';

const geomCache = new Map<TableId, TableGeometry>();
export function geometryOf(table: TableId): TableGeometry {
  let g = geomCache.get(table);
  if (!g) {
    g = buildTableGeometry(TABLES[table]);
    geomCache.set(table, g);
  }
  return g;
}

export const rulesOf = (state: Pick<MatchState, 'ruleSet'>): RuleSet => RULESETS[state.ruleSet];
export const physicsOf = (state: Pick<MatchState, 'ruleSet'>) => PHYSICS[DISCIPLINES[RULESETS[state.ruleSet].discipline].physics];

function clone(state: MatchState): MatchState {
  return structuredClone(state);
}

function setPhase(state: MatchState, to: GamePhase): void {
  assertTransition(state.phase, to);
  state.phase = to;
}

const newPlayer = (name: string, timeouts: number): PlayerState => ({
  name,
  score: 0,
  sets: 0,
  innings: 0,
  run: 0,
  highRun: 0,
  timeoutsLeft: timeouts,
});

/** Create a match in WaitingPlayers; call startMatch once both players are ready. */
export function createMatch<R extends RuleSetId>(setup: MatchSetup<R>): MatchState {
  const rules = RULESETS[setup.ruleSet];
  const config = { ...RULE_DEFAULTS[setup.ruleSet], ...(setup.config ?? {}) } as AnyRuleConfig;
  if (!DISCIPLINES[rules.discipline].tables.includes(setup.table)) {
    throw new Error(`table ${setup.table} not allowed for ${setup.ruleSet}`);
  }
  return {
    ruleSet: setup.ruleSet,
    table: setup.table,
    config,
    phase: 'WaitingPlayers',
    players: [newPlayer(setup.names[0], config.timeouts), newPlayer(setup.names[1], config.timeouts)],
    current: setup.firstBreaker,
    breaker: setup.firstBreaker,
    set: 1,
    balls: [],
    ballInHand: null,
    breakShot: true,
    rule: rules.initialRuleState(),
    shots: 0,
    winner: null,
    lastVerdict: null,
    sets: [],
    seed: setup.seed >>> 0,
  };
}

function rackRng(state: MatchState): () => number {
  return createRng((state.seed + state.set * 0x9e3779b1) >>> 0);
}

/** Lay out the rack / set for `state.breaker` and hand the table to them. Mutates `state`. */
function layRack(state: MatchState, from: GamePhase): void {
  const rules = rulesOf(state);
  const setup = rules.setupRack(state, TABLES[state.table], rackRng(state), physicsOf(state).rackGap);
  state.balls = setup.balls;
  state.ballInHand = setup.ballInHand;
  state.breakShot = true;
  state.current = state.breaker;
  state.rule = rules.initialRuleState();
  for (const p of state.players) p.run = 0;
  state.players[state.breaker].innings += 1;
  state.phase = from;
  setPhase(state, setup.ballInHand ? 'BallInHand' : 'Aiming');
}

export function startMatch(state: MatchState): MatchState {
  const s = clone(state);
  layRack(s, 'WaitingPlayers');
  return s;
}

/** Validate a shot request against the current state. Returns null if it is acceptable. */
export function validateShot(state: MatchState, seat: Seat, req: ShotRequest): ShotError | null {
  if (state.phase !== 'Aiming' && state.phase !== 'BallInHand') return 'wrongPhase';
  if (seat !== state.current) return 'notYourTurn';
  const { angle, power, spinX, spinY } = req.input;
  if (![angle, power, spinX, spinY].every(Number.isFinite)) return 'badInput';
  if (power <= 0 || power > 1) return 'badInput';
  if (Math.hypot(spinX, spinY) > 1 + 1e-9) return 'badInput';
  if (state.ballInHand) {
    if (!req.cueBallPos) return 'placementRequired';
    const cue = rulesOf(state).cueBallOf(state, seat);
    if (!isValidPlacement(geometryOf(state.table), state.balls, cue, req.cueBallPos, state.ballInHand)) return 'badPlacement';
  }
  return null;
}

export interface ShotOutcome {
  state: MatchState;
  /** Balls right before the strike (after ball-in-hand placement): the replay start. */
  start: MatchState['balls'];
  cueBall: string;
  log: ShotLog;
  verdict: Verdict;
}

/** Simulate and judge a shot. Throws if the request is invalid (call validateShot first). */
export function applyShot(state: MatchState, seat: Seat, req: ShotRequest): ShotOutcome {
  const err = validateShot(state, seat, req);
  if (err) throw new Error(`invalid shot: ${err}`);
  const s = clone(state);
  const rules = rulesOf(s);
  const cueBall = rules.cueBallOf(s, seat);
  if (s.ballInHand && req.cueBallPos) {
    s.balls = s.balls.map((b) => (b.id === cueBall ? { id: b.id, x: req.cueBallPos!.x, y: req.cueBallPos!.y, pocketed: false } : b));
  }
  const start = s.balls.map((b) => ({ ...b }));
  setPhase(s, 'Shooting');
  setPhase(s, 'Simulating');
  const log = simulateShot(geometryOf(s.table), physicsOf(s), start, cueBall, req.input);
  const { state: next, verdict } = judgeShotLog(s, log);
  return { state: next, start, cueBall, log, verdict };
}

/**
 * Judge a finished shot and advance the state machine (Simulating → Resolving → …).
 * Split from applyShot so the rules can be driven by recorded or synthetic shot logs.
 */
export function judgeShotLog(state: MatchState, log: ShotLog): { state: MatchState; verdict: Verdict } {
  const s = clone(state);
  if (s.phase === 'Aiming' || s.phase === 'BallInHand') {
    setPhase(s, 'Shooting');
    setPhase(s, 'Simulating');
  }
  setPhase(s, 'Resolving');
  // Rules see the state before the shot (with the cue ball placed) plus the log.
  const verdict = rulesOf(s).evaluate(s, log);
  s.balls = log.final.map((b) => ({ ...b }));
  s.shots += 1;
  resolve(s, verdict);
  return { state: s, verdict };
}

/** The shot clock expired: the rules decide (turn passes, maybe ball in hand). */
export function applyTimeViolation(state: MatchState): { state: MatchState; verdict: Verdict } {
  if (state.phase !== 'Aiming' && state.phase !== 'BallInHand') throw new Error('no shot pending');
  const s = clone(state);
  const verdict = rulesOf(s).onTimeViolation(s);
  setPhase(s, 'Resolving');
  resolve(s, verdict);
  return { state: s, verdict };
}

/** Spend one extension. Returns null if the seat cannot. */
export function useTimeout(state: MatchState, seat: Seat): MatchState | null {
  if (state.phase !== 'Aiming' && state.phase !== 'BallInHand') return null;
  if (seat !== state.current || state.players[seat].timeoutsLeft <= 0) return null;
  const s = clone(state);
  s.players[seat].timeoutsLeft -= 1;
  return s;
}

/** Apply a verdict to a state in Resolving. Mutates `s`. */
function resolve(s: MatchState, v: Verdict): void {
  const rules = rulesOf(s);
  const shooter = v.shooter;
  const p = s.players[shooter];
  if (v.points > 0) {
    p.score += v.points;
    p.run += v.points;
    p.highRun = Math.max(p.highRun, p.run);
  }
  if (v.penalty > 0) p.score = Math.max(0, p.score - v.penalty);
  if (v.respot) {
    for (const r of v.respot) s.balls = s.balls.map((b) => (b.id === r.id ? { ...r } : b));
  }
  if (v.rule) s.rule = v.rule;
  s.breakShot = false;
  s.lastVerdict = v;

  if (v.gameWinner !== undefined) {
    s.winner = v.gameWinner;
    s.ballInHand = null;
    if (v.gameWinner !== 'draw') s.players[v.gameWinner].sets += 1;
    s.sets.push({ winner: v.gameWinner === 'draw' ? shooter : v.gameWinner, scores: [s.players[0].score, s.players[1].score] });
    setPhase(s, 'GameOver');
    return;
  }

  if (v.setWinner !== undefined) {
    const w = v.setWinner;
    s.players[w].sets += 1;
    s.sets.push({ winner: w, scores: [s.players[0].score, s.players[1].score] });
    s.ballInHand = null;
    if (s.players[w].sets >= rules.setsToWin(s.config)) {
      s.winner = w;
      setPhase(s, 'GameOver');
    } else {
      s.current = w;
      setPhase(s, 'SetOver');
    }
    return;
  }

  if (!v.keepTurn) {
    p.run = 0;
    s.current = other(shooter);
    s.players[s.current].innings += 1;
  }
  s.ballInHand = v.ballInHand;
  setPhase(s, s.ballInHand ? 'BallInHand' : 'Aiming');
}

/** After SetOver: next rack / set. */
export function startNextSet(state: MatchState): MatchState {
  if (state.phase !== 'SetOver') throw new Error('not between sets');
  const s = clone(state);
  const rules = rulesOf(s);
  const lastWinner = s.sets[s.sets.length - 1].winner;
  s.breaker = rules.nextBreaker(s, lastWinner);
  s.set += 1;
  if (rules.resetScoreEachSet) for (const p of s.players) p.score = 0;
  if (rules.timeoutScope === 'set') for (const p of s.players) p.timeoutsLeft = s.config.timeouts;
  for (const p of s.players) p.innings = 0;
  layRack(s, 'SetOver');
  return s;
}

/** Cue ball for the seat to move. */
export const cueBallFor = (state: MatchState, seat: Seat = state.current): string => rulesOf(state).cueBallOf(state, seat);

/** End the match by forfeit (disconnect, resignation). */
export function forfeit(state: MatchState, loser: Seat): MatchState {
  const s = clone(state);
  s.winner = other(loser);
  s.phase = 'GameOver';
  return s;
}
